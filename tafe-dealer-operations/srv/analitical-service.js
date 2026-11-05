const cds = require("@sap/cds");

const {
    Dealer,
    PurchaseOrders,
    POLineItems,
    Products,
    PriceMaster,
    PriceHistory,

    DealerAnalytics,
    PurchaseOrderAnalytics,
    ProductSalesAnalytics,
    PricingAnalytics,
    MonthlyAnalytics
} = cds.entities("tafe.dealer");


module.exports = cds.service.impl(function () {

    /* =====================================================
       CALCULATE ANALYTICS
       ===================================================== */

    this.on("calculateAnalytics", async (req) => {

        const { month, year } = req.data;

        /* -------------------------------------------------
           VALIDATION
           ------------------------------------------------- */

        if (!month || !year) {
            return req.error(
                400,
                "Month and year are required"
            );
        }

        if (month < 1 || month > 12) {
            return req.error(
                400,
                "Month must be between 1 and 12"
            );
        }

        if (year < 2000) {
            return req.error(
                400,
                "Invalid year"
            );
        }


        const tx = cds.tx(req);


        /* =================================================
           DATE RANGE
           ================================================= */

        const startDate =
            `${year}-${String(month).padStart(2, "0")}-01`;

        let nextMonth = month + 1;
        let nextYear = year;

        if (nextMonth === 13) {
            nextMonth = 1;
            nextYear++;
        }

        const endDate =
            `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;


        /* =================================================
           DELETE OLD ANALYTICS
           ================================================= */

        await tx.run(
            DELETE.from(DealerAnalytics)
                .where({
                    analyticsMonth: month,
                    analyticsYear: year
                })
        );

        await tx.run(
            DELETE.from(PurchaseOrderAnalytics)
                .where({
                    analyticsMonth: month,
                    analyticsYear: year
                })
        );

        await tx.run(
            DELETE.from(ProductSalesAnalytics)
                .where({
                    analyticsMonth: month,
                    analyticsYear: year
                })
        );

        await tx.run(
            DELETE.from(PricingAnalytics)
                .where({
                    analyticsMonth: month,
                    analyticsYear: year
                })
        );

        await tx.run(
            DELETE.from(MonthlyAnalytics)
                .where({
                    analyticsMonth: month,
                    analyticsYear: year
                })
        );


        /* =================================================
           GET PURCHASE ORDERS
           ================================================= */

        const purchaseOrders = await tx.run(
            SELECT.from(PurchaseOrders)
                .where({
                    orderDate: {
                        ">=": startDate,
                        "<": endDate
                    }
                })
        );


        /* =================================================
           PURCHASE ORDER ANALYTICS
           ================================================= */

        let totalPOCount = 0;

        let approvedPOCount = 0;

        let rejectedPOCount = 0;

        let deliveredPOCount = 0;

        let totalPurchaseValue = 0;

        let totalTaxAmount = 0;


        totalPOCount = purchaseOrders.length;


        for (const po of purchaseOrders) {

            const amount =
                Number(po.totalAmount || 0);

            const tax =
                Number(po.taxAmount || 0);


            totalPurchaseValue += amount;

            totalTaxAmount += tax;


            if (po.status === "APPROVED") {
                approvedPOCount++;
            }

            if (po.status === "REJECT") {
                rejectedPOCount++;
            }

            if (po.status === "DELIVERED") {
                deliveredPOCount++;
            }
        }


        const averagePOValue =
            totalPOCount > 0
                ? totalPurchaseValue / totalPOCount
                : 0;


        await tx.run(
            INSERT.into(PurchaseOrderAnalytics).entries({

                analyticsMonth: month,

                analyticsYear: year,

                totalPOCount,

                approvedPOCount,

                rejectedPOCount,

                deliveredPOCount,

                totalPurchaseValue,

                totalTaxAmount,

                averagePOValue
            })
        );


        /* =================================================
           GET PO LINE ITEMS
           ================================================= */

        const lineItems = await tx.run(

            SELECT.from(POLineItems)
                .columns(
                    "ID",
                    "quantity",
                    "unitPrice",
                    "lineTotal",
                    "product_ID",
                    "priceMaster_ID",
                    "purchaseOrder_ID"
                )
                .where({

                    "purchaseOrder.orderDate": {
                        ">=": startDate,
                        "<": endDate
                    }
                })
        );


        /* =================================================
           PRODUCT SALES ANALYTICS
           ================================================= */

        const productMap = new Map();


        for (const item of lineItems) {

            const productId =
                item.product_ID;

            if (!productId) {
                continue;
            }


            if (!productMap.has(productId)) {

                productMap.set(productId, {

                    totalQuantity: 0,

                    totalPOCount: new Set(),

                    totalSalesValue: 0,

                    totalUnitPrice: 0,

                    itemCount: 0
                });
            }


            const product =
                productMap.get(productId);


            product.totalQuantity +=
                Number(item.quantity || 0);


            product.totalSalesValue +=
                Number(item.lineTotal || 0);


            product.totalUnitPrice +=
                Number(item.unitPrice || 0);


            product.totalPOCount.add(
                item.purchaseOrder_ID
            );


            product.itemCount++;
        }


        for (const [
            productId,
            data
        ] of productMap.entries()) {


            const averageUnitPrice =
                data.itemCount > 0
                    ? data.totalUnitPrice /
                      data.itemCount
                    : 0;


            await tx.run(

                INSERT.into(
                    ProductSalesAnalytics
                ).entries({

                    product_ID: productId,

                    analyticsMonth: month,

                    analyticsYear: year,

                    totalQuantity:
                        data.totalQuantity,

                    totalPOCount:
                        data.totalPOCount.size,

                    totalSalesValue:
                        data.totalSalesValue,

                    averageUnitPrice:
                        averageUnitPrice
                })
            );
        }


        /* =================================================
           PRICING ANALYTICS
           ================================================= */

        const priceMasters = await tx.run(

            SELECT.from(PriceMaster)
                .columns(
                    "ID",
                    "product_ID",
                    "basePrice",
                    "discount",
                    "finalPrice",
                    "validFrom",
                    "validTo",
                    "status"
                )
                .where({

                    validFrom: {
                        "<": endDate
                    }
                })
        );


        const pricingMap = new Map();


        for (const price of priceMasters) {

            const productId =
                price.product_ID;

            if (!productId) {
                continue;
            }


            /*
             * Ignore prices which were already expired
             * before the selected month.
             */

            if (
                price.validTo &&
                price.validTo < startDate
            ) {
                continue;
            }


            if (!pricingMap.has(productId)) {

                pricingMap.set(productId, {

                    basePriceTotal: 0,

                    discountTotal: 0,

                    finalPriceTotal: 0,

                    count: 0
                });
            }


            const data =
                pricingMap.get(productId);


            data.basePriceTotal +=
                Number(price.basePrice || 0);


            data.discountTotal +=
                Number(price.discount || 0);


            data.finalPriceTotal +=
                Number(price.finalPrice || 0);


            data.count++;
        }


        /* =================================================
           PRICE HISTORY
           ================================================= */

        const priceHistory = await tx.run(

            SELECT.from(PriceHistory)
                .columns(
                    "ID",
                    "priceMaster_ID",
                    "oldFinalPrice",
                    "newFinalPrice",
                    "changeReason",
                    "changedOn"
                )
                .where({

                    changedOn: {
                        ">=":
                            `${startDate}T00:00:00`,

                        "<":
                            `${endDate}T00:00:00`
                    }
                })
        );


        /*
         * Map PriceMaster -> Product
         */

        const priceMasterMap =
            new Map();


        for (const price of priceMasters) {

            priceMasterMap.set(
                price.ID,
                price.product_ID
            );
        }


        const priceChangeMap =
            new Map();


        for (const history of priceHistory) {

            const productId =
                priceMasterMap.get(
                    history.priceMaster_ID
                );


            if (!productId) {
                continue;
            }


            priceChangeMap.set(

                productId,

                (
                    priceChangeMap.get(productId)
                    || 0
                ) + 1
            );
        }


        /* =================================================
           INSERT PRICING ANALYTICS
           ================================================= */

        for (const [
            productId,
            data
        ] of pricingMap.entries()) {


            const averageBasePrice =
                data.count > 0
                    ? data.basePriceTotal /
                      data.count
                    : 0;


            const averageDiscount =
                data.count > 0
                    ? data.discountTotal /
                      data.count
                    : 0;


            const averageFinalPrice =
                data.count > 0
                    ? data.finalPriceTotal /
                      data.count
                    : 0;


            const priceChangeCount =
                priceChangeMap.get(productId)
                || 0;


            /*
             * Total discount amount
             *
             * Here discount is treated as the
             * discount amount stored in PriceMaster.
             */

            const totalDiscountAmount =
                data.discountTotal;


            await tx.run(

                INSERT.into(
                    PricingAnalytics
                ).entries({

                    product_ID: productId,

                    analyticsMonth: month,

                    analyticsYear: year,

                    averageBasePrice:
                        averageBasePrice,

                    averageDiscount:
                        averageDiscount,

                    averageFinalPrice:
                        averageFinalPrice,

                    totalDiscountAmount:
                        totalDiscountAmount,

                    priceChangeCount:
                        priceChangeCount
                })
            );
        }


        /* =================================================
           DEALER ANALYTICS
           ================================================= */

        const dealerMap = new Map();


        for (const po of purchaseOrders) {

            const dealerId =
                po.dealer_ID;


            if (!dealerId) {
                continue;
            }


            if (!dealerMap.has(dealerId)) {

                dealerMap.set(dealerId, {

                    totalPOCount: 0,

                    approvedPOCount: 0,

                    rejectedPOCount: 0,

                    deliveredPOCount: 0,

                    totalPurchaseValue: 0,

                    totalTaxAmount: 0
                });
            }


            const dealer =
                dealerMap.get(dealerId);


            dealer.totalPOCount++;


            dealer.totalPurchaseValue +=
                Number(po.totalAmount || 0);


            dealer.totalTaxAmount +=
                Number(po.taxAmount || 0);


            if (po.status === "APPROVED") {
                dealer.approvedPOCount++;
            }

            if (po.status === "REJECT") {
                dealer.rejectedPOCount++;
            }

            if (po.status === "DELIVERED") {
                dealer.deliveredPOCount++;
            }
        }


        /* =================================================
           INSERT DEALER ANALYTICS
           ================================================= */

        for (const [
            dealerId,
            data
        ] of dealerMap.entries()) {


            const averagePOValue =
                data.totalPOCount > 0
                    ? data.totalPurchaseValue /
                      data.totalPOCount
                    : 0;


            await tx.run(

                INSERT.into(
                    DealerAnalytics
                ).entries({

                    dealer_ID: dealerId,

                    analyticsMonth: month,

                    analyticsYear: year,

                    totalPOCount:
                        data.totalPOCount,

                    approvedPOCount:
                        data.approvedPOCount,

                    rejectedPOCount:
                        data.rejectedPOCount,

                    deliveredPOCount:
                        data.deliveredPOCount,

                    totalPurchaseValue:
                        data.totalPurchaseValue,

                    totalTaxAmount:
                        data.totalTaxAmount,

                    averagePOValue:
                        averagePOValue
                })
            );
        }


        /* =================================================
           TOTAL QUANTITY
           ================================================= */

        let totalQuantity = 0;


        for (const item of lineItems) {

            totalQuantity +=
                Number(item.quantity || 0);
        }


        /* =================================================
           TOTAL DISCOUNT
           ================================================= */

        let totalDiscountAmount = 0;


        for (const data of pricingMap.values()) {

            totalDiscountAmount +=
                data.discountTotal;
        }


        /* =================================================
           PREVIOUS MONTH SALES
           ================================================= */

        let previousMonth =
            month - 1;

        let previousYear =
            year;


        if (previousMonth === 0) {

            previousMonth = 12;

            previousYear--;
        }


        const previousAnalytics =
            await tx.run(

                SELECT.one
                    .from(MonthlyAnalytics)
                    .where({

                        analyticsMonth:
                            previousMonth,

                        analyticsYear:
                            previousYear
                    })
            );


        let salesGrowthPercentage = 0;


        if (
            previousAnalytics &&
            Number(
                previousAnalytics.totalPurchaseValue
            ) > 0
        ) {


            salesGrowthPercentage =

                (
                    (
                        totalPurchaseValue -
                        Number(
                            previousAnalytics
                                .totalPurchaseValue
                        )
                    )
                    /
                    Number(
                        previousAnalytics
                            .totalPurchaseValue
                    )
                ) * 100;
        }


        /* =================================================
           MONTHLY ANALYTICS
           ================================================= */

        await tx.run(

            INSERT.into(
                MonthlyAnalytics
            ).entries({

                analyticsMonth: month,

                analyticsYear: year,

                totalPOCount,

                totalPurchaseValue,

                totalQuantity,

                totalDiscountAmount,

                totalTaxAmount,

                averagePOValue,

                salesGrowthPercentage
            })
        );


        /* =================================================
           SUCCESS
           ================================================= */

        return (
            `Analytics calculated successfully ` +
            `for ${month}/${year}`
        );
    });


    /* =====================================================
       CURRENT MONTH ANALYTICS
       ===================================================== */

    this.on(
        "calculateCurrentMonthAnalytics",
        async (req) => {

            const now = new Date();

            const month =
                now.getMonth() + 1;

            const year =
                now.getFullYear();


            /*
             * Directly call the calculation logic
             * through the service action.
             */

            const result =
                await this.send(
                    "calculateAnalytics",
                    {
                        month,
                        year
                    }
                );


            return result;
        }
    );


    /* =====================================================
       CLEAR ANALYTICS
       ===================================================== */

    this.on(
        "clearAnalytics",
        async (req) => {

            const {
                month,
                year
            } = req.data;


            if (!month || !year) {

                return req.error(
                    400,
                    "Month and year are required"
                );
            }


            const tx = cds.tx(req);


            await tx.run(

                DELETE.from(
                    DealerAnalytics
                ).where({

                    analyticsMonth:
                        month,

                    analyticsYear:
                        year
                })
            );


            await tx.run(

                DELETE.from(
                    PurchaseOrderAnalytics
                ).where({

                    analyticsMonth:
                        month,

                    analyticsYear:
                        year
                })
            );


            await tx.run(

                DELETE.from(
                    ProductSalesAnalytics
                ).where({

                    analyticsMonth:
                        month,

                    analyticsYear:
                        year
                })
            );


            await tx.run(

                DELETE.from(
                    PricingAnalytics
                ).where({

                    analyticsMonth:
                        month,

                    analyticsYear:
                        year
                })
            );


            await tx.run(

                DELETE.from(
                    MonthlyAnalytics
                ).where({

                    analyticsMonth:
                        month,

                    analyticsYear:
                        year
                })
            );


            return (
                `Analytics cleared successfully ` +
                `for ${month}/${year}`
            );
        }
    );

});