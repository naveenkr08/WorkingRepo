const cds = require("@sap/cds");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const { SELECT } = require("@sap/cds/lib/ql/cds-ql");

const {
    Dealer,
    PurchaseOrders,
    POLineItems,
    Products,
    Regions,
    PriceMaster,
    PriceHistory,
    PriceExpiryLog,
    Inventory,
    warehouse
} = cds.entities("tafe.dealer");

// ============================================================
// BPA CONFIGURATION
// ============================================================

const WORKFLOW_DEFINITION_ID =
    process.env.WORKFLOW_DEFINITION_ID ||
    "us10.6a738d3btrial.purchaseorderapproval.approvalProcess";

const DESTINATION_NAME = "purchasebpi";
//const { Warehouses } = this.entities;


// ============================================================
// SERVICE IMPLEMENTATION
// ============================================================

module.exports = cds.service.impl(async function () {


    // ============================================================
    // PURCHASE ORDER
    // ============================================================


    // ============================================================
    // CREATE PURCHASE ORDER
    // ============================================================

     this.before("CREATE", "PurchaseOrders", async (req) => {
 
        const {
            dealer_ID
        } = req.data;
       
        // 1. Mandatory validation
 
        if (!dealer_ID) {
            return req.reject(
                400,
                "Dealer is mandatory to create a Purchase Order."
            );
        }
 
        // 2. Dealer existence & status check
        const dealer =
            await SELECT.one
                .from(Dealer)
                .where({
                    ID: dealer_ID
                });
 
        if (!dealer) {
            return req.reject(
                404,
                `Dealer ${dealer_ID} does not exist.`
            );
        }
 
        if (dealer.status !== "ACTIVE") {
            return req.reject(
                400,
                `Dealer ${dealer.dealerCode} is not active. Purchase Orders can only be raised for active dealers.`
            );
        }
 
        // 3. Defaults
        req.data.orderDate =
            req.data.orderDate ||
            new Date().toISOString().slice(0, 10);
 
        // req.data.status = "PENDING";
        // req.data.totalAmount = 0;
        // req.data.taxAmount = 0;
 
    });


    // ============================================================
    // GENERATE PO NUMBER
    // ============================================================

    this.before("CREATE", "PurchaseOrders", async (req) => {

    const aPOs =
        await SELECT
            .columns("poNumber")
            .from(PurchaseOrders);

    let maxNumber = 0;

    aPOs.forEach((oPO) => {

        if (!oPO.poNumber) {
            return;
        }

        const match =
            String(oPO.poNumber)
                .match(/(\d+)$/);

        if (match) {

            const currentNumber =
                parseInt(match[1], 10);

            if (
                !isNaN(currentNumber) &&
                currentNumber > maxNumber
            ) {
                maxNumber = currentNumber;
            }
        }
    });

    const nextValue =
        maxNumber + 1;

    const year =
        new Date().getFullYear();

    req.data.poNumber =
        `SO-${year}-${nextValue}`;
});


    // ============================================================
    // UPDATE PURCHASE ORDER
    // ============================================================

    this.before("UPDATE", "PurchaseOrders", async (req) => {

        const poId =
            req.params[0].ID;


        const po =
            await SELECT.one
                .from(PurchaseOrders)
                .where({
                    ID: poId
                });


        if (!po) {

            return req.reject(
                404,
                "Purchase Order not found."
            );
        }


        // ----------------------------------------------------
        // PO number cannot be changed
        // ----------------------------------------------------

        if (req.data.poNumber !== undefined) {

            return req.reject(
                400,
            "SO number cannot be modified."
            );
        }


        // ----------------------------------------------------
        // Status cannot be changed directly
        // ----------------------------------------------------

        if (req.data.status !== undefined) {

            return req.reject(
                400,
                "Purchase Order status can only be changed through business actions."
            );
        }


        // ----------------------------------------------------
        // Header fields locked once submitted
        // ----------------------------------------------------

        if (po.status !== "PENDING") {

            return req.reject(
                400,
                "Purchase Order can only be edited while in PENDING status."
            );
        }
    });


    // ============================================================
    // CREATE / UPDATE PO LINE ITEMS
    // ============================================================

    this.before(
        ["CREATE", "UPDATE"],
        "POLineItems",
        async (req) => {

            const {
                quantity,
                product_ID,
                purchaseOrder_ID
            } = req.data;

            let {
                unitPrice
            } = req.data;


            // ----------------------------------------------------
            // 1. Quantity validation
            // ----------------------------------------------------

            if (quantity == null || quantity <= 0) {

                return req.reject(
                    400,
                    "Quantity must be greater than zero."
                );
            }


            // ----------------------------------------------------
            // 2. Product existence / active check
            // ----------------------------------------------------

            let product = null;


            if (product_ID) {

                product =
                    await SELECT.one
                        .from(Products)
                        .where({
                            ID: product_ID
                        });


                if (!product) {

                    return req.reject(
                        404,
                        `Product ${product_ID} does not exist.`
                    );
                }


                if (!product.active) {

                    return req.reject(
                        400,
                        `Product ${product.productCode} is not active.`
                    );
                }
            }


            // ----------------------------------------------------
            // 3. Auto-fetch unit price from PriceMaster
            // ----------------------------------------------------

            if (unitPrice == null && product_ID) {

                const today =
                    new Date().toISOString().slice(0, 10);


                const activePrice =
                    await SELECT.one
                        .from(PriceMaster)
                        .where`
                            product_ID = ${product_ID}
                            and status = 'ACTIVE'
                            and validFrom <= ${today}
                            and validTo >= ${today}
                        `;


                if (!activePrice) {

                    return req.reject(
                        400,
                        `No active price found for product ${product.productCode}. Please provide unitPrice manually.`
                    );
                }


                unitPrice =
                    activePrice.finalPrice;

                req.data.unitPrice =
                    unitPrice;
            }


            if (unitPrice == null || unitPrice < 0) {

                return req.reject(
                    400,
                    "Unit price cannot be negative."
                );
            }


            // ----------------------------------------------------
            // 4. Purchase Order status check
            // ----------------------------------------------------

            if (purchaseOrder_ID) {

                const po =
                    await SELECT.one
                        .from(PurchaseOrders)
                        .where({
                            ID: purchaseOrder_ID
                        });


                if (!po) {

                    return req.reject(
                        404,
                        `Purchase Order ${purchaseOrder_ID} does not exist.`
                    );
                }


                if (po.status !== "PENDING") {

                    return req.reject(
                        400,
                        "Line items can only be modified while the Purchase Order is in PENDING status."
                    );
                }
            }


            // ----------------------------------------------------
            // 5. Line total calculation
            // ----------------------------------------------------

            req.data.lineTotal =
                +(quantity * unitPrice).toFixed(2);
        }
    );


    // ============================================================
    // RECALCULATE PURCHASE ORDER TOTALS
    // ============================================================

    this.after(
        ["CREATE", "UPDATE", "DELETE"],
        "POLineItems",
        async (_result, req) => {

            const poId =
                req.data?.purchaseOrder_ID ||
                (
                    req.params?.[0] &&
                    req.params[0].purchaseOrder_ID
                );


            if (!poId) {
                return;
            }


            const items =
                await SELECT
                    .from(POLineItems)
                    .where({
                        purchaseOrder_ID: poId
                    });


            const TAX_RATE = 0.18;


            const totalAmount =
                +items
                    .reduce(
                        (sum, item) =>
                            sum + (item.lineTotal || 0),
                        0
                    )
                    .toFixed(2);


            const taxAmount =
                +(totalAmount * TAX_RATE).toFixed(2);


            await UPDATE(PurchaseOrders)
                .set({
                    totalAmount,
                    taxAmount
                })
                .where({
                    ID: poId
                });
        }
    );


    // ============================================================
    // SUBMIT PURCHASE ORDER
    // ============================================================

    this.on(
        "submitPO",
        "PurchaseOrders",
        async (req) => {

            const poId =
                req.params[0].ID;


            // ----------------------------------------------------
            // Get Purchase Order
            // ----------------------------------------------------

            const po =
                await SELECT.one
                    .from(PurchaseOrders)
                    .where({
                        ID: poId
                    });


            if (!po) {

                return req.reject(
                    404,
                    "Purchase Order not found."
                );
            }


            // ----------------------------------------------------
            // Status validation
            // ----------------------------------------------------

            if (po.status !== "PENDING") {

                return req.reject(
                    400,
                    "Only a PENDING Purchase Order can be submitted."
                );
            }


            // ----------------------------------------------------
            // Check line items
            // ----------------------------------------------------

            const items =
                await SELECT
                    .from(POLineItems)
                    .where({
                        purchaseOrder_ID: poId
                    });


            if (!items.length) {

                return req.reject(
                    400,
                    "Cannot submit a Purchase Order with no line items."
                );
            }


            // ----------------------------------------------------
            // Get Dealer Details
            // ----------------------------------------------------

            const dealer =
                await SELECT.one
                    .from(Dealer)
                    .where({
                        ID: po.dealer_ID
                    });


            if (!dealer) {

                return req.reject(
                    404,
                    "Dealer not found for this Purchase Order."
                );
            }


            // ----------------------------------------------------
            // Change PO status to SUBMITTED
            // ----------------------------------------------------

            await UPDATE(PurchaseOrders)
                .set({
                    status: "SUBMITTED"
                })
                .where({
                    ID: poId
                });


            // ====================================================
            // START SAP BUILD PROCESS AUTOMATION
            // ====================================================

            const payload = {

                definitionId:
                    WORKFLOW_DEFINITION_ID,

                context: {

                    // PO information
                    poid:
                       String(po.ID),

                    ponumber:
                       String(po.poNumber),

                    // Dealer information
                    dealerid:
                        String(dealer.ID),

                    dealername:
                        String(dealer.dealerName),

                    dealercode:
                        String(dealer.dealerCode),

                    // Amount
                    totalamount:
                        Number(po.totalAmount || 0),

                    // Date
                    orderdate:
                        po.orderDate
                }
            };


            console.log(
                "Starting BPA workflow with payload:",
                JSON.stringify(payload, null, 2)
            );


            try {

                const response =
                    await executeHttpRequest(

                        {
                            destinationName:
                                DESTINATION_NAME
                        },

                        {
                            method: "post",

                            url:
                                "/workflow/rest/v1/workflow-instances",

                            data:
                                payload,

                            headers: {
                                "Content-Type":
                                    "application/json"
                            }
                        }
                    );


                console.log(
                    "BPA workflow started successfully:",
                    response.data
                );

            } catch (error) {

                console.error(
                    "BPA workflow failed:",
                    error.message
                );


                return req.error(
                    502,
                    `Purchase Order submitted, but failed to start workflow via ${DESTINATION_NAME}: ${error.message}`
                );
            }


            // ----------------------------------------------------
            // Final response
            // ----------------------------------------------------

            return "Purchase Order submitted successfully for approval.";
        }
    );


    // ============================================================
    // APPROVE PURCHASE ORDER
    // ============================================================

    // ============================================================
// APPROVE PURCHASE ORDER
// ============================================================

this.on("approvePO", "PurchaseOrders", async (req) => {
    const poId = req.params[0].ID;

    // 1. Get Purchase Order
    const po = await SELECT.one
        .from(PurchaseOrders)
        .where({ ID: poId });

    if (!po) {
        return req.reject(404, "Purchase Order not found.");
    }

    // 2. Status validation
    if (po.status !== "SUBMITTED") {
        return req.reject(
            400,
            "Only a SUBMITTED Purchase Order can be approved."
        );
    }

    // 3. Get PO Line Items
    const items = await SELECT
        .from(POLineItems)
        .where({ purchaseOrder_ID: poId });

    if (!items.length) {
        return req.reject(
            400,
            "Cannot approve a Purchase Order with no line items."
        );
    }

    // 4. Combine quantities for duplicate products
    const requiredQuantities = new Map();

    for (const item of items) {
        const quantity = Number(item.quantity || 0);

        if (!item.product_ID || quantity <= 0) {
            return req.reject(
                400,
                "Product and a valid quantity are required for every line item."
            );
        }

        requiredQuantities.set(
            item.product_ID,
            (requiredQuantities.get(item.product_ID) || 0) + quantity
        );
    }

    // 5. Validate all products and inventory before updating stock
    const stockUpdates = [];

    for (const [productId, requiredQuantity] of requiredQuantities) {
        const product = await SELECT.one
            .from(Products)
            .where({ ID: productId });

        if (!product) {
            return req.reject(
                404,
                `Product ${productId} not found.`
            );
        }

        if (!product.active) {
            return req.reject(
                400,
                `Product ${product.productCode} is not active.`
            );
        }

        // Inventory lookup using only product_ID
        const stock = await SELECT.one
            .from(Inventory)
            .where({ product_ID: productId });

        if (!stock) {
            return req.reject(
                404,
                `Inventory record not found for product ${product.productCode}.`
            );
        }

        const availableQuantity = Number(stock.availableQuantity || 0);

        if (availableQuantity < requiredQuantity) {
            return req.reject(
                400,
                `Insufficient stock for product ${product.productCode}. Available: ${availableQuantity}, Required: ${requiredQuantity}.`
            );
        }

        stockUpdates.push({
            stock,
            product,
            requiredQuantity,
            remainingStock: availableQuantity - requiredQuantity
        });
    }

    // 6. Deduct stock after all validations pass
    for (const update of stockUpdates) {
        const { stock, product, requiredQuantity, remainingStock } = update;

        let inventoryStatus = "AVAILABLE";

        if (remainingStock === 0) {
            inventoryStatus = "OUT_OF_STOCK";
        } else if (
            remainingStock <= Number(stock.reorderLevel || 0)
        ) {
            inventoryStatus = "LOW_STOCK";
        }

        await UPDATE(Inventory)
            .set({
                availableQuantity: remainingStock,
                lastStockUpdate: new Date(),
                status: inventoryStatus
            })
            .where({ ID: stock.ID });
    }

    // 7. Update Purchase Order status
    await UPDATE(PurchaseOrders)
        .set({
            status: "APPROVED",
            rejectionReason: null
        })
        .where({ ID: poId });

    return "Purchase Order approved successfully and stock quantity updated.";
});


    // ============================================================
    // REJECT PURCHASE ORDER
    // ============================================================

    this.on(
        "rejectPO",
        "PurchaseOrders",
        async (req) => {

            const poId =
                req.params[0].ID;


            const {
                reason
            } = req.data;


            // ----------------------------------------------------
            // Reason validation
            // ----------------------------------------------------

            if (!reason || !reason.trim()) {

                return req.reject(
                    400,
                    "Rejection reason is mandatory."
                );
            }


            // ----------------------------------------------------
            // Get Purchase Order
            // ----------------------------------------------------

            const po =
                await SELECT.one
                    .from(PurchaseOrders)
                    .where({
                        ID: poId
                    });


            if (!po) {

                return req.reject(
                    404,
                    "Purchase Order not found."
                );
            }


            // ----------------------------------------------------
            // Status validation
            // ----------------------------------------------------

            if (po.status !== "SUBMITTED") {

                return req.reject(
                    400,
                    "Only a SUBMITTED Purchase Order can be rejected."
                );
            }


            // ----------------------------------------------------
            // Update status
            // ----------------------------------------------------

            await UPDATE(PurchaseOrders)
                .set({
                    status: "REJECTED",
                    rejectionReason: reason.trim()
                })
                .where({
                    ID: poId
                });


            // ----------------------------------------------------
            // Response
            // ----------------------------------------------------

            return "Purchase Order rejected successfully.";
        }
    );


    // ============================================================
    // DELETE PURCHASE ORDER
    // ============================================================

    /*
    this.before(
        "DELETE",
        "PurchaseOrders",
        async (req) => {

            const poId =
                req.params[0].ID;


            const po =
                await SELECT.one
                    .from(PurchaseOrders)
                    .where({
                        ID: poId
                    });


            if (po && po.status !== "PENDING") {

                return req.reject(
                    405,
                    "Only PENDING purchase orders can be deleted."
                );
            }
        }
    );
    */


    // ============================================================
    // PRICE MASTER
    // ============================================================


    // ============================================================
    // CREATE / UPDATE PRICE MASTER
    // ============================================================

    this.before(
        ["CREATE", "UPDATE"],
        "PriceMaster",
        async (req) => {

            const priceId =
                req.params[0] &&
                req.params[0].ID;


            let existing = null;


            if (priceId) {

                existing =
                    await SELECT.one
                        .from(PriceMaster)
                        .where({
                            ID: priceId
                        });


                if (!existing) {

                    return req.reject(
                        404,
                        "Price record not found."
                    );
                }
            }


            // ----------------------------------------------------
            // Product
            // ----------------------------------------------------

            const productId =
                req.data.product_ID ||
                (
                    existing &&
                    existing.product_ID
                );


            if (req.data.product_ID) {

                const product =
                    await SELECT.one
                        .from(Products)
                        .where({
                            ID: req.data.product_ID
                        });


                if (!product) {

                    return req.reject(
                        404,
                        `Product ${req.data.product_ID} does not exist.`
                    );
                }
            }


            // ----------------------------------------------------
            // Numeric fields
            // ----------------------------------------------------

            const basePrice =
                req.data.basePrice ??
                (
                    existing
                        ? existing.basePrice
                        : undefined
                );


            const discount =
                req.data.discount ??
                (
                    existing
                        ? existing.discount
                        : 0
                );


            const tax =
                req.data.tax ??
                (
                    existing
                        ? existing.tax
                        : 0
                );


            if (basePrice == null || basePrice < 0) {

                return req.reject(
                    400,
                    "Base price is mandatory and cannot be negative."
                );
            }


            if (discount < 0) {

                return req.reject(
                    400,
                    "Discount cannot be negative."
                );
            }


            if (tax < 0) {

                return req.reject(
                    400,
                    "Tax cannot be negative."
                );
            }


            // ----------------------------------------------------
            // Validity period
            // ----------------------------------------------------

            const validFrom =
                req.data.validFrom ??
                (
                    existing
                        ? existing.validFrom
                        : undefined
                );


            const validTo =
                req.data.validTo ??
                (
                    existing
                        ? existing.validTo
                        : undefined
                );


            if (
                validFrom &&
                validTo &&
                validFrom > validTo
            ) {

                return req.reject(
                    400,
                    "Valid From date cannot be after Valid To date."
                );
            }


            // ----------------------------------------------------
            // Compute final price
            // ----------------------------------------------------

            req.data.finalPrice =
                +(
                    (basePrice - discount) + tax
                ).toFixed(2);


            // ----------------------------------------------------
            // Price history context
            // ----------------------------------------------------

            if (existing) {

                req._priceHistoryContext = {

                    priceId,

                    oldFinalPrice:
                        existing.finalPrice
                };
            }
        }
    );


    // ============================================================
    // LOG PRICE HISTORY ON UPDATE
    // ============================================================

    this.after(
        "UPDATE",
        "PriceMaster",
        async (data, req) => {

            const context =
                req._priceHistoryContext;


            if (!context) {
                return;
            }


            if (
                context.oldFinalPrice ===
                data.finalPrice
            ) {
                return;
            }


            await INSERT
                .into(PriceHistory)
                .entries({

                    priceMaster_ID:
                        context.priceId,

                    oldFinalPrice:
                        context.oldFinalPrice,

                    newFinalPrice:
                        data.finalPrice,

                    changeReason:
                        "Price updated",

                    changedOn:
                        new Date().toISOString(),

                    changedBy:
                        (
                            req.user &&
                            req.user.id
                        ) || "SYSTEM"
                });
        }
    );


    // ============================================================
    // EXPIRE PRICE
    // ============================================================

    this.on(
        "expirePrice",
        "PriceMaster",
        async (req) => {

            const priceId =
                req.params[0].ID;


            const price =
                await SELECT.one
                    .from(PriceMaster)
                    .where({
                        ID: priceId
                    });


            if (!price) {

                return req.reject(
                    404,
                    "Price record not found."
                );
            }


            if (price.status !== "ACTIVE") {

                return req.reject(
                    400,
                    "Only ACTIVE price records can be expired."
                );
            }


            await UPDATE(PriceMaster)
                .set({
                    status: "EXPIRED"
                })
                .where({
                    ID: priceId
                });


            await INSERT
                .into(PriceHistory)
                .entries({

                    priceMaster_ID:
                        priceId,

                    oldFinalPrice:
                        price.finalPrice,

                    newFinalPrice:
                        price.finalPrice,

                    changeReason:
                        "Manually expired",

                    changedOn:
                        new Date().toISOString(),

                    changedBy:
                        (
                            req.user &&
                            req.user.id
                        ) || "SYSTEM"
                });


            return "Price record expired successfully.";
        }
    );


    // ============================================================
    // RUN PRICE EXPIRY CHECK
    // ============================================================

    this.on(
        "runPriceExpiryCheck",
        async (req) => {

            const today =
                new Date()
                    .toISOString()
                    .slice(0, 10);


            const expiredRecords =
                await SELECT
                    .from(PriceMaster)
                    .where`
                        status = 'ACTIVE'
                        and validTo < ${today}
                    `;


            for (const record of expiredRecords) {

                await UPDATE(PriceMaster)
                    .set({
                        status: "EXPIRED"
                    })
                    .where({
                        ID: record.ID
                    });
            }


            await INSERT
                .into(PriceExpiryLog)
                .entries({

                    runOn:
                        new Date().toISOString(),

                    expiredCount:
                        expiredRecords.length,

                    details:
                        `Expired ${expiredRecords.length} price record(s) with validTo before ${today}.`,

                    triggeredBy:
                        (
                            req.user &&
                            req.user.id
                        ) || "SYSTEM"
                });


            return `Price expiry check completed. ${expiredRecords.length} price record(s) expired.`;
        }
    );

      this.on('READ', 'Regions', async (req) => {

        const regions = await SELECT.from('Regions');

        const dealers = await SELECT.from('Dealer');

        const purchaseOrders = await SELECT.from('PurchaseOrders');

        const dealerRegionMap = {};

        dealers.forEach(dealer => {

            dealerRegionMap[dealer.ID] = dealer.region_ID;

        });

        const regionTotals = {};

        purchaseOrders.forEach(po => {

            const dealerID = po.dealer_ID;

            const regionID = dealerRegionMap[dealerID];

            if (!regionID) {
                return;
            }

            if (!regionTotals[regionID]) {
                regionTotals[regionID] = 0;
            }

            // Add PO totalAmount
            regionTotals[regionID] += Number(po.totalAmount || 0);

        });


        regions.forEach(region => {

            region.totalPurchaseValue =
                regionTotals[region.ID] || 0;

        });


        return regions;
    });

    this.before("CREATE", "Products", async (req) => {
    if (!req.data.productName) {
        return req.reject(400, "Product Name is mandatory.");
    }

    const prefix = req.data.productName
        .trim()
        .replace(/[^a-zA-Z]/g, "")
        .substring(0, 3)
        .toUpperCase();

    const randomNumber = Math.floor(1000 + Math.random() * 9000);

    req.data.productCode = `${prefix}-${randomNumber}`;
});

    

   this.before("CREATE", "warehouse", async (req) => {
    const city = req.data.city?.trim();

    // Validate city
    if (!city) {
        return req.reject(
            400,
            "City is required to generate warehouse code"
        );
    }

    // Generate city prefix
    // Chennai   -> CH
    // Hyderabad -> HY
    // Bangalore -> BA
    const cityPrefix = city
        .split(/\s+/)
        .map(word => word.substring(0, 2))
        .join("")
        .toUpperCase()
        .substring(0, 2);

    const prefix = `WH-${cityPrefix}-`;

    // Find the latest warehouse code for this city
    const lastWarehouse = await SELECT.one
        .from("tafe.dealer.Warehouses")
        .columns("warehouseCode")
        .where({
            warehouseCode: {
                like: `${prefix}%`
            }
        })
        .orderBy("warehouseCode desc");

    let nextNumber = 1;

    if (lastWarehouse?.warehouseCode) {
        const lastNumber = parseInt(
            lastWarehouse.warehouseCode.split("-").pop(),
            10
        );

        if (Number.isNaN(lastNumber)) {
            return req.reject(
                500,
                "Unable to determine the next warehouse code"
            );
        }

        nextNumber = lastNumber + 1;
    }

    // Assign generated code
    req.data.warehouseCode =
        `${prefix}${String(nextNumber).padStart(3, "0")}`;
});





});