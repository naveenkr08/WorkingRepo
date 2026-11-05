const cds = require("@sap/cds");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const { SELECT, UPDATE, INSERT } = cds.ql;

const {
    Dealer,
    OnboardingApprovals
} = cds.entities("tafe.dealer");


const WORKFLOW_DEFINITION_ID =
    process.env.WORKFLOW_DEFINITION_ID ||
    "us10.3f4ffa21trial.dealerapproval1.dealerApproval";

const DESTINATION_NAME = "purchasebpi";


// VALIDATION PATTERNS

const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE_REGEX = /^[6-9][0-9]{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns the dealer ID from the request keys.
 * With draft enabled, req.params[0] is { ID, IsActiveEntity };
 * without draft it can be the plain ID.
 */
function getDealerId(req) {
    const key = req.params && req.params[0];
    return key && typeof key === "object" ? key.ID : key;
}

/**
 * Moves a dealer to a new status and writes the approval history.
 * Used by the unbound actions that SAP Build Process Automation (BPA) calls
 * (bpaL1Approve, bpaL2Approve, bpaReject), which only receive the dealerId.
 */
async function moveDealer(req, dealerId, fromStatuses, toStatus, action, level, text) {

    if (!dealerId) {
        return req.reject(400, "dealerId is required.");
    }

    const dealer = await SELECT.one
        .from(Dealer)
        .where({ ID: dealerId });

    if (!dealer) {
        return req.reject(404, "Dealer not found.");
    }

    if (!fromStatuses.includes(dealer.status)) {
        return req.reject(
            400,
            `Dealer is ${dealer.status}; expected ${fromStatuses.join(" or ")}.`
        );
    }

    const remarks = text && text.trim() ? text.trim() : null;
    const label = action.toLowerCase().replace("_", " ");

    await UPDATE(Dealer)
        .set({ status: toStatus, remarks })
        .where({ ID: dealerId });

    await INSERT.into(OnboardingApprovals).entries({
        dealer_ID: dealerId,
        action,
        level,
        remarks: remarks || `Dealer ${label}.`,
        actionBy: req.user.id || "BPA",
        actionAt: new Date()
    });

    return `Dealer ${label} successfully.`;
}

module.exports = cds.service.impl(async function () {


    // CREATE DEALER
    // Runs on POST (non-draft) and when a new draft is activated.

    this.before("CREATE", "Dealers", async (req) => {

        let {
            dealerName,
            gstNumber,
            panNumber,
            phone,
            email
        } = req.data;


        if (!dealerName || !dealerName.trim()) {
            return req.reject(400, "Dealer name is mandatory.");
        }

        if (!gstNumber || !gstNumber.trim()) {
            return req.reject(400, "GST number is mandatory.");
        }

        if (!panNumber || !panNumber.trim()) {
            return req.reject(400, "PAN number is mandatory.");
        }

        if (!phone || !phone.trim()) {
            return req.reject(400, "Phone number is mandatory.");
        }


        // Normalize data

        dealerName = dealerName.trim();
        gstNumber = gstNumber.trim().toUpperCase();
        panNumber = panNumber.trim().toUpperCase();
        phone = phone.trim();

        if (email) {
            email = email.trim().toLowerCase();
        }

        req.data.dealerName = dealerName;
        req.data.gstNumber = gstNumber;
        req.data.panNumber = panNumber;
        req.data.phone = phone;
        req.data.email = email;


        // Format validation

        if (!GST_REGEX.test(gstNumber)) {
            return req.reject(400, "Invalid GST number format.");
        }

        if (!PAN_REGEX.test(panNumber)) {
            return req.reject(400, "Invalid PAN number format.");
        }

        if (!PHONE_REGEX.test(phone)) {
            return req.reject(400, "Invalid phone number.");
        }

        if (email && !EMAIL_REGEX.test(email)) {
            return req.reject(400, "Invalid email address.");
        }


        // Duplicate GST

        const gstExists = await SELECT.one
            .from(Dealer)
            .where({ gstNumber });

        if (gstExists) {
            return req.reject(
                409,
                "Dealer with this GST number already exists."
            );
        }


        // Duplicate PAN

        const panExists = await SELECT.one
            .from(Dealer)
            .where({ panNumber });

        if (panExists) {
            return req.reject(
                409,
                "Dealer with this PAN number already exists."
            );
        }


        // Duplicate phone

        const phoneExists = await SELECT.one
            .from(Dealer)
            .where({ phone });

        if (phoneExists) {
            return req.reject(
                409,
                "Dealer with this phone number already exists."
            );
        }


        // Duplicate email

        if (email) {

            const emailExists = await SELECT.one
                .from(Dealer)
                .where({ email });

            if (emailExists) {
                return req.reject(
                    409,
                    "Dealer with this email already exists."
                );
            }
        }


        // Initial status

        req.data.status = "PENDING";

    });


    // GENERATE DEALER CODE

    this.before("CREATE", "Dealers", async (req) => {

        /*
         * Production / HANA:
         * Use HANA sequence.
         *
         * Local / SQLite:
         * Generate next dealer code from existing records.
         */

        if (cds.db.kind === "hana") {

            // HANA

            const result = await cds.db.run(
                'SELECT "TAFE_DEALER_CODE_SEQ".NEXTVAL AS "NEXT_VALUE" FROM DUMMY'
            );

            const nextValue = result[0].NEXT_VALUE;

            req.data.dealerCode =
                `DLR${String(nextValue).padStart(5, "0")}`;

        } else {

            // SQLite - Local Development

            const result = await SELECT.one
                .from(Dealer)
                .columns("dealerCode")
                .orderBy("dealerCode desc");

            let nextValue = 1;

            if (result && result.dealerCode) {

                const currentNumber = parseInt(
                    result.dealerCode.replace("DLR", ""),
                    10
                );

                if (!isNaN(currentNumber)) {
                    nextValue = currentNumber + 1;
                }
            }

            req.data.dealerCode =
                `DLR${String(nextValue).padStart(5, "0")}`;
        }

    });


    // UPDATE DEALER
    // Runs on PATCH (non-draft) and when an edited draft is activated.
    // On draft activation the full entity is sent, so dealerCode and
    // status are compared with the stored values instead of rejected
    // whenever they are present.

    this.before("UPDATE", "Dealers", async (req) => {

        const dealerId = getDealerId(req);

        const dealer = await SELECT.one
            .from(Dealer)
            .where({ ID: dealerId });

        if (!dealer) {
            return req.reject(
                404,
                "Dealer not found."
            );
        }


        // Dealer code cannot be changed

        if (
            req.data.dealerCode !== undefined &&
            req.data.dealerCode !== dealer.dealerCode
        ) {
            return req.reject(
                400,
                "Dealer code cannot be modified."
            );
        }


        // Status cannot be changed directly

        if (
            req.data.status !== undefined &&
            req.data.status !== dealer.status
        ) {
            return req.reject(
                400,
                "Dealer status can only be changed through business actions."
            );
        }


        // GST validation

        if (req.data.gstNumber) {

            const gst = req.data.gstNumber
                .trim()
                .toUpperCase();

            if (!GST_REGEX.test(gst)) {
                return req.reject(
                    400,
                    "Invalid GST number format."
                );
            }

            req.data.gstNumber = gst;
        }


        // PAN validation

        if (req.data.panNumber) {

            const pan = req.data.panNumber
                .trim()
                .toUpperCase();

            if (!PAN_REGEX.test(pan)) {
                return req.reject(
                    400,
                    "Invalid PAN number format."
                );
            }

            req.data.panNumber = pan;
        }


        // Phone validation

        if (req.data.phone) {

            const phone = req.data.phone.trim();

            if (!PHONE_REGEX.test(phone)) {
                return req.reject(
                    400,
                    "Invalid phone number."
                );
            }

            req.data.phone = phone;
        }


        // Email validation

        if (req.data.email) {

            const email = req.data.email
                .trim()
                .toLowerCase();

            if (!EMAIL_REGEX.test(email)) {
                return req.reject(
                    400,
                    "Invalid email address."
                );
            }

            req.data.email = email;
        }


        // Duplicate GST during UPDATE

        if (req.data.gstNumber) {

            const existingGST = await SELECT.one
                .from(Dealer)
                .where({ gstNumber: req.data.gstNumber });

            if (existingGST && existingGST.ID !== dealerId) {
                return req.reject(
                    409,
                    "Dealer with this GST number already exists."
                );
            }
        }


        // Duplicate PAN during UPDATE

        if (req.data.panNumber) {

            const existingPAN = await SELECT.one
                .from(Dealer)
                .where({ panNumber: req.data.panNumber });

            if (existingPAN && existingPAN.ID !== dealerId) {
                return req.reject(
                    409,
                    "Dealer with this PAN number already exists."
                );
            }
        }


        // Duplicate phone during UPDATE

        if (req.data.phone) {

            const existingPhone = await SELECT.one
                .from(Dealer)
                .where({ phone: req.data.phone });

            if (existingPhone && existingPhone.ID !== dealerId) {
                return req.reject(
                    409,
                    "Dealer with this phone number already exists."
                );
            }
        }


        // Duplicate email during UPDATE

        if (req.data.email) {

            const existingEmail = await SELECT.one
                .from(Dealer)
                .where({ email: req.data.email });

            if (existingEmail && existingEmail.ID !== dealerId) {
                return req.reject(
                    409,
                    "Dealer with this email already exists."
                );
            }
        }

    });


    // SUBMIT DEALER

    this.on("submitDealer", "Dealers", async (req) => {

        const dealerId = getDealerId(req);

        const dealer = await SELECT.one
            .from(Dealer)
            .where({ ID: dealerId });

        if (!dealer) {
            return req.reject(404, "Dealer not found.");
        }

        if (dealer.status !== "PENDING") {
            return req.reject(400, "Only pending dealers can be submitted.");
        }

        await UPDATE(Dealer)
            .set({ status: "SUBMITTED" })
            .where({ ID: dealerId });

        await INSERT.into(OnboardingApprovals).entries({
            dealer_ID: dealerId,
            action: "SUBMITTED",
            level: 0,
            remarks: "Dealer submitted for approval.",
            actionBy: req.user.id || "SYSTEM",
            actionAt: new Date()
        });

        // ====================================================
        // START SAP BUILD PROCESS AUTOMATION
        // ====================================================

        const payload = {
            definitionId: WORKFLOW_DEFINITION_ID,
            context: {
                dealercode: String(dealer.dealerCode || ""),
                dealername: String(dealer.dealerName || ""),
                gstnumber: String(dealer.gstNumber || ""),
                pannumber: String(dealer.panNumber || ""),
                phone: String(dealer.phone || ""),
                email: String(dealer.email || ""),
                state: String(dealer.state || ""),
                country: String(dealer.country || ""),
                dealerId: String(dealer.ID || ""),
                reason: ""
            }
        };

        console.log("Starting Dealer BPA workflow with payload:", JSON.stringify(payload, null, 2));

        try {

            const response = await executeHttpRequest(
                { destinationName: DESTINATION_NAME },
                {
                    method: "post",
                    url: "/workflow/rest/v1/workflow-instances",
                    data: payload,
                    headers: { "Content-Type": "application/json" }
                },
                { fetchCsrfToken: false }
            );

            console.log("Dealer BPA workflow started successfully:", response.data);

        } catch (error) {

            const detail = error.response?.data
                ? JSON.stringify(error.response.data)
                : error.message;

            console.error(
                "Dealer BPA workflow failed:",
                error.message,
                error.response?.status,
                detail
            );

            // The whole request is rolled back, so the dealer stays PENDING.
            // 400 on purpose while debugging, so the real reason shows in the UI popup.
            // Once this works, replace the message with a plain one, for example:
            // return req.reject(502, "Could not start the approval workflow.");
            return req.reject(
                400,
                `Could not start approval workflow (${error.response?.status || "no response"}): ${detail}`.substring(0, 500)
            );
        }

        return "Dealer submitted successfully for approval.";
    });


    // L1 APPROVE DEALER

    this.on("l1Approve", "Dealers", async (req) => {

        const dealerId = getDealerId(req);

        const { remarks } = req.data;


        // Authorization

        // if (
        //     !req.user.is("DealerManager") &&
        //     !req.user.is("Admin")
        // ) {
        //     return req.reject(
        //         403,
        //         "You are not authorized to approve dealers."
        //     );
        // }


        const dealer = await SELECT.one
            .from(Dealer)
            .where({ ID: dealerId });

        if (!dealer) {
            return req.reject(
                404,
                "Dealer not found."
            );
        }


        // Status validation

        if (dealer.status !== "SUBMITTED") {
            return req.reject(
                400,
                "Only submitted dealers can be approved by L1."
            );
        }


        // Update dealer

        await UPDATE(Dealer)
            .set({
                status: "L1_APPROVED",
                remarks: remarks ? remarks.trim() : null
            })
            .where({ ID: dealerId });


        // Save approval history

        await INSERT.into(OnboardingApprovals).entries({
            dealer_ID: dealerId,
            action: "L1_APPROVED",
            level: 1,
            remarks: remarks
                ? remarks.trim()
                : "Dealer approved by L1.",
            actionBy: req.user.id || "SYSTEM",
            actionAt: new Date()
        });


        return "Dealer approved successfully by L1.";

    });


    // L2 APPROVE DEALER

    this.on("l2Approve", "Dealers", async (req) => {

        const dealerId = getDealerId(req);

        const { remarks } = req.data;


        // Authorization

        // if (
        //     !req.user.is("DealerManager") &&
        //     !req.user.is("Admin")
        // ) {
        //     return req.reject(
        //         403,
        //         "You are not authorized to approve dealers."
        //     );
        // }


        const dealer = await SELECT.one
            .from(Dealer)
            .where({ ID: dealerId });

        if (!dealer) {
            return req.reject(
                404,
                "Dealer not found."
            );
        }


        // Status validation

        if (dealer.status !== "L1_APPROVED") {
            return req.reject(
                400,
                "Only L1-approved dealers can be approved by L2."
            );
        }


        // Update dealer to ACTIVE

        await UPDATE(Dealer)
            .set({
                status: "ACTIVE",
                remarks: remarks ? remarks.trim() : null
            })
            .where({ ID: dealerId });


        // Save approval history

        await INSERT.into(OnboardingApprovals).entries({
            dealer_ID: dealerId,
            action: "L2_APPROVED",
            level: 2,
            remarks: remarks
                ? remarks.trim()
                : "Dealer approved by L2.",
            actionBy: req.user.id || "SYSTEM",
            actionAt: new Date()
        });


        return "Dealer approved successfully by L2.";

    });


    // REJECT DEALER

    this.on("rejectDealer", "Dealers", async (req) => {

        const dealerId = getDealerId(req);
        const { reason } = req.data;

        const rejectionReason = reason?.trim() || "";

        const dealer = await SELECT.one
            .from(Dealer)
            .where({ ID: dealerId });

        if (!dealer) {
            return req.reject(
                404,
                "Dealer not found."
            );
        }

        if (
            dealer.status !== "PENDING" &&
            dealer.status !== "SUBMITTED" &&
            dealer.status !== "L1_APPROVED"
        ) {
            return req.reject(
                400,
                "Dealer cannot be rejected from the current status."
            );
        }

        const rejectionLevel =
            dealer.status === "L1_APPROVED"
                ? 1
                : 0;

        await UPDATE(Dealer)
            .set({
                status: "REJECTED",
                remarks: rejectionReason
            })
            .where({ ID: dealerId });

        await INSERT.into(OnboardingApprovals).entries({
            dealer_ID: dealerId,
            action: "REJECTED",
            level: rejectionLevel,
            remarks: rejectionReason,
            actionBy: req.user.id || "SYSTEM",
            actionAt: new Date()
        });

        return "Dealer rejected successfully.";
    });


    // BLOCK DEALER

    this.on("blockDealer", "Dealers", async (req) => {

        const dealerId = getDealerId(req);

        const { reason, remarks } = req.data;


        // Authorization

        // if (
        //     !req.user.is("DealerManager") &&
        //     !req.user.is("Admin")
        // ) {
        //     return req.reject(
        //         403,
        //         "You are not authorized to block dealers."
        //     );
        // }


        // Reason validation

        if (!reason || !reason.trim()) {
            return req.reject(
                400,
                "Block reason is mandatory."
            );
        }


        const dealer = await SELECT.one
            .from(Dealer)
            .where({ ID: dealerId });

        if (!dealer) {
            return req.reject(
                404,
                "Dealer not found."
            );
        }


        // Only active dealers can be blocked

        if (dealer.status !== "ACTIVE") {
            return req.reject(
                400,
                "Only active dealers can be blocked."
            );
        }


        // Update dealer

        await UPDATE(Dealer)
            .set({
                status: "BLOCKED",
                blockedReason: reason.trim(),
                remarks: remarks ? remarks.trim() : null
            })
            .where({ ID: dealerId });


        // Save block history

        await INSERT.into(OnboardingApprovals).entries({
            dealer_ID: dealerId,
            action: "BLOCKED",
            level: 0,
            remarks:
                reason.trim() +
                (remarks ? " - " + remarks.trim() : ""),
            actionBy: req.user.id || "SYSTEM",
            actionAt: new Date()
        });


        return "Dealer blocked successfully.";

    });


    // ============================================================
    // ACTIONS CALLED BY SAP BUILD PROCESS AUTOMATION (BPA)
    // Unbound actions: BPA only needs the dealerId from the
    // trigger context, not the two-part draft key.
    // ============================================================

    this.on("bpaL1Approve", (req) =>
        moveDealer(req, req.data.dealerId, ["SUBMITTED"], "L1_APPROVED", "L1_APPROVED", 1, req.data.remarks)
    );

    this.on("bpaL2Approve", (req) =>
        moveDealer(req, req.data.dealerId, ["L1_APPROVED"], "ACTIVE", "L2_APPROVED", 2, req.data.remarks)
    );

    this.on("bpaReject", (req) =>
        moveDealer(req, req.data.dealerId, ["SUBMITTED", "L1_APPROVED"], "REJECTED", "REJECTED", 1, req.data.reason)
    );


    // DELETE DEALER

    // this.before("DELETE", "Dealers", async (req) => {

    //     return req.reject(
    //         405,
    //         "Dealer deletion is not allowed. Use business status actions."
    //     );

    // });


    // GET CITIES BY STATE

    this.on("getCitiesByState", async (req) => {

        const { state } = req.data;

        if (!state || !state.trim()) {
            return req.reject(400, "State is required.");
        }

        try {

            const response = await executeHttpRequest(
                { destinationName: "CityAPI" },
                {
                    method: "POST",
                    url: "/countries/state/cities",
                    data: {
                        country: "India",
                        state: state.trim()
                    },
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );

            const bError =
                response.data && response.data.error;

            if (bError) {
                return req.reject(
                    502,
                    response.data.msg ||
                        "External city service returned an error."
                );
            }

            const aCities =
                (response.data && response.data.data) || [];

            return aCities;

        } catch (oError) {

            console.error("========== CityAPI ERROR ==========");
            console.error("Message:", oError.message);
            console.error("Status:", oError.response?.status);
            console.error("Status Text:", oError.response?.statusText);
            console.error("Response Data:", oError.response?.data);
            console.error("Response Headers:", oError.response?.headers);
            console.error("Stack:", oError.stack);
            console.error("===================================");

            return req.reject(
                502,
                oError.response?.data?.msg ||
                oError.response?.data?.message ||
                oError.message ||
                "Unable to fetch cities from external service."
            );
        }
    });


    // GEOCODE ADDRESS
    // NOTE: this uses the CityAPI destination, which points to the city service,
    // not to Nominatim. It will fail until a separate destination (for example
    // "GeocodeAPI" -> https://nominatim.openstreetmap.org) exists and its name
    // is used below. The UI currently calls Nominatim directly, so nothing
    // depends on this handler today.

    this.on("geocodeAddress", async (req) => {

        const { query } = req.data;

        if (!query || !query.trim()) {
            return req.reject(400, "Address query is required.");
        }

        try {

            const response = await executeHttpRequest(
                { destinationName: "CityAPI" },
                {
                    method: "GET",
                    url: "/search",
                    params: {
                        q: query.trim(),
                        format: "json",
                        limit: 1,
                        countrycodes: "in"
                    }
                }
            );

            const aResults = response.data || [];

            if (!aResults.length) {
                return req.reject(404, "Address not found.");
            }

            const oResult = aResults[0];

            return {
                latitude: parseFloat(oResult.lat),
                longitude: parseFloat(oResult.lon),
                displayName: oResult.display_name
            };

        } catch (oError) {

            console.error(
                "geocodeAddress - GeocodeAPI error:",
                oError.message
            );

            return req.reject(
                502,
                "Unable to geocode address."
            );
        }
    });

});