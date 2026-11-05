
const cds = require('@sap/cds');

// Dedicated logger - when bound to the Application Logging service on BTP,
const LOG = cds.log('pricing-service');

module.exports = cds.service.impl(async function () {

    const { Products, PriceMaster, Regions, PriceHistory, PriceExpiryLog,Warehouses} = this.entities;

    // finalPrice = (basePrice - discountAmount) + taxAmount
    function computeFinalPrice(basePrice, discount = 0, tax = 0) {
        const base = Number(basePrice) || 0;
        const disc = Number(discount) || 0;
        const taxPct = Number(tax) || 0;

        const discountAmount = base * (disc / 100);
        const taxableAmount = base - discountAmount;
        const taxAmount = taxableAmount * (taxPct / 100);

        return Math.round((taxableAmount + taxAmount) * 100) / 100;
    }

    function deriveStatus(validTo) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return new Date(validTo) < today ? 'EXPIRED' : 'PENDING';
    }

    function makeReadOnlyGuard(entityLabel) {
        return (req) => {
            req.reject(405, `${entityLabel} is system-managed and cannot be modified directly via the API.`);
        };
    }


this.before("CREATE", Products, async (req) => {
    const { productName, category } = req.data;

    // 1. Validate mandatory product name
    if (!productName?.trim()) {
        return req.reject(400, "Product name is required.");
    }

    // 2. Normalize product name and category
    const normalizedName = productName.trim().toLowerCase();
    const normalizedCategory = (category || "").trim().toLowerCase();

    // 3. Check for duplicate product name + category
    const existingProducts = await SELECT.from(Products);

    const duplicate = existingProducts.find((product) => {
        const existingName = (product.productName || "").trim().toLowerCase();
        const existingCategory = (product.category || "").trim().toLowerCase();

        return (
            existingName === normalizedName &&
            existingCategory === normalizedCategory
        );
    });

    if (duplicate) {
        return req.reject(
            400,
            `Product '${productName.trim()}' already exists in this category.`
        );
    }

    // 4. Generate product code from the first 3 letters
    const prefix = productName
        .trim()
        .replace(/[^a-zA-Z]/g, "")
        .substring(0, 3)
        .toUpperCase();

    if (!prefix) {
        return req.reject(400, "Product name must contain letters.");
    }

    // 5. Generate a unique product code
    let productCode;
    let exists = true;
    let attempts = 0;

    while (exists && attempts < 10) {
        const randomNumber = Math.floor(1000 + Math.random() * 9000);
        productCode = `${prefix}-${randomNumber}`;

        const existingCode = await SELECT.one
            .from(Products)
            .where({ productCode });

        exists = !!existingCode;
        attempts++;
    }

    if (exists) {
        return req.reject(
            500,
            "Unable to generate a unique product code. Please try again."
        );
    }

    req.data.productCode = productCode;

    // 6. Default active status
    
        req.data.active = false;
    
});

    this.before('UPDATE', Products, async (req) => {
        const { ID, productCode } = req.data;
        const errors = [];

        if (productCode) {
            const dup = await SELECT.one.from(Products).where({ productCode, ID: { '!=': ID } });
            if (dup) errors.push(`Product code '${productCode}' is already used by another product.`);
        }

        // Guard: deactivating a product should not silently orphan active prices
        if (req.data.active === false) {
            const activePrices = await SELECT.from(PriceMaster).where({ product_ID: ID, status: 'ACTIVE' });
            if (activePrices.length > 0) {
                errors.push(
                    `Cannot deactivate product: ${activePrices.length} ACTIVE price record(s) still reference it. ` +
                    `Expire or reassign them first.`
                );
            }
        }

        if (errors.length) req.error(400, errors.join(' '));
    });

    this.before('DELETE', Products, async (req) => {
        const { ID } = req.data;
        const linkedPrices = await SELECT.from(PriceMaster).where({ product_ID: ID });

        if (linkedPrices.length > 0) {
            req.error(
                409,
                `Cannot delete product: ${linkedPrices.length} price record(s) reference it. ` +
                `Delete or reassign those PriceMaster records first.`
            );
        }
    });

    this.after(['CREATE', 'UPDATE', 'DELETE'], Products, (data, req) => {
        LOG.info(`Product ${req.event}`, { productId: data?.ID });
    });

    this.before('CREATE', Regions, async (req) => {
        const { regionCode, regionName } = req.data;
        const errors = [];

        if (!regionCode) errors.push('Region code is required.');
        if (!regionName) errors.push('Region name is required.');

        if (regionCode) {
            const dup = await SELECT.one.from(Regions).where({ regionCode });
            if (dup) errors.push(`Region code '${regionCode}' already exists.`);
        }

        if (errors.length) req.error(400, errors.join(' '));
    });

    this.before('UPDATE', Regions, async (req) => {
        const { ID, regionCode } = req.data;
        if (!regionCode) return;

        const dup = await SELECT.one.from(Regions).where({ regionCode, ID: { '!=': ID } });
        if (dup) req.error(400, `Region code '${regionCode}' is already used by another region.`);
    });

    this.before('DELETE', Regions, async (req) => {
        const { ID } = req.data;
        const linkedPrices = await SELECT.from(PriceMaster).where({ region_ID: ID });

        if (linkedPrices.length > 0) {
            req.error(
                409,
                `Cannot delete region: ${linkedPrices.length} price record(s) reference it.`
            );
        }
    });

    this.after(['CREATE', 'UPDATE', 'DELETE'], Regions, (data, req) => {
        LOG.info(`Region ${req.event}`, { regionId: data?.ID });
    });


    async function validatePriceInput(req, data, isUpdate = false) {
        const errors = [];

        if (!isUpdate || data.basePrice !== undefined) {
            if (data.basePrice === undefined || data.basePrice === null) {
                errors.push('Base price is required.');
            } else if (Number(data.basePrice) <= 0) {
                errors.push('Base price must be greater than zero.');
            }
        }

        if (data.discount !== undefined && data.discount !== null) {
            if (Number(data.discount) < 0 || Number(data.discount) > 100) {
                errors.push('Discount must be between 0 and 100 (percentage).');
            }
        }

        if (data.tax !== undefined && data.tax !== null) {
            if (Number(data.tax) < 0 || Number(data.tax) > 100) {
                errors.push('Tax must be between 0 and 100 (percentage).');
            }
        }

        if (!isUpdate) {
            if (!data.validFrom) errors.push('Valid From date is required.');
            if (!data.validTo) errors.push('Valid To date is required.');
            if (!data.product_ID) errors.push('Product reference is required.');
        }

        if (data.validFrom && data.validTo) {
            if (new Date(data.validFrom) > new Date(data.validTo)) {
                errors.push('Valid From date cannot be after Valid To date.');
            }
        }

        if (data.product_ID) {
            const product = await SELECT.one.from(Products).where({ ID: data.product_ID });
            if (!product) {
                errors.push(`Product with ID ${data.product_ID} does not exist.`);
            } else if (product.active === false) {
                errors.push(`Product '${product.productName}' is inactive and cannot be priced.`);
            }
        }

        if (data.region_ID) {
            const region = await SELECT.one.from(Regions).where({ ID: data.region_ID });
            if (!region) errors.push(`Region with ID ${data.region_ID} does not exist.`);
        }

        if (errors.length) req.error(400, errors.join(' '));
    }

    // ---- CREATE ----
    this.before('CREATE', PriceMaster, async (req) => {
        await validatePriceInput(req, req.data, false);
    });

    this.on('CREATE', PriceMaster, async (req, next) => {
    req.data.finalPrice = computeFinalPrice(
        req.data.basePrice,
        req.data.discount,
        req.data.tax
    );

    req.data.status = deriveStatus(req.data.validTo);

    const result = await next();

    const productId = req.data.product_ID;

    // Check whether an inventory record exists
    const inventory = await SELECT.one
        .from(Inventory)
        .where({ product_ID: productId });

    // Activate only when the price is ACTIVE and inventory exists
    const shouldBeActive =
        req.data.status === 'ACTIVE' &&
        Boolean(inventory);

    await UPDATE(Products)
        .set({ active: shouldBeActive })
        .where({ ID: productId });

    LOG.info('Price created', {
        priceId: req.data.ID,
        product: productId,
        finalPrice: req.data.finalPrice,
        status: req.data.status,
        productActive: shouldBeActive
    });

    return result;
});

    // ---- UPDATE ----
    this.before('UPDATE', PriceMaster, async (req) => {
        const existing = await SELECT.one.from(PriceMaster).where({ ID: req.data.ID });
        if (!existing) req.error(404, `Price record ${req.data.ID} not found.`);

        if (existing.status === 'EXPIRED' && req.data.status === undefined && req.data.validTo === undefined) {
            req.error(409, 'This price record is EXPIRED. Create a new price record instead of editing this one.');
        }

        await validatePriceInput(req, req.data, true);
    });

    this.on('UPDATE', PriceMaster, async (req, next) => {
        const priceAffectingFieldChanged =
            req.data.basePrice !== undefined ||
            req.data.discount !== undefined ||
            req.data.tax !== undefined;

        if (priceAffectingFieldChanged) {
            const existing = await SELECT.one.from(PriceMaster).where({ ID: req.data.ID });

            const basePrice = req.data.basePrice ?? existing.basePrice;
            const discount = req.data.discount ?? existing.discount;
            const tax = req.data.tax ?? existing.tax;

            const oldFinalPrice = existing.finalPrice;
            const newFinalPrice = computeFinalPrice(basePrice, discount, tax);
            req.data.finalPrice = newFinalPrice;

            if (oldFinalPrice !== newFinalPrice) {
                await INSERT.into(PriceHistory).entries({
                    priceMaster_ID: req.data.ID,
                    oldFinalPrice,
                    newFinalPrice,
                    changeReason: 'Base price / discount / tax updated',
                    changedOn: new Date().toISOString(),
                    changedBy: req.user?.id || 'SYSTEM'
                });
            }
        }

        if (req.data.validTo !== undefined) {
            req.data.status = deriveStatus(req.data.validTo);
        }

        const result = await next();
        LOG.info('Price updated', { priceId: req.data.ID });
        return result;
    });

    // ---- DELETE ----
    this.before('DELETE', PriceMaster, async (req) => {
        const priceId = req.data.ID || req.params?.[0]?.ID;

        const existing = await SELECT.one.from(PriceMaster).where({ ID: priceId });
        if (!existing) req.error(404, `Price record ${priceId} not found.`);

        if (existing.status === 'ACTIVE') {
            req.error(
                409,
                `Cannot delete an ACTIVE price record. Set it to INACTIVE or let it expire first, ` +
                `then delete.`
            );
        }

        await INSERT.into(PriceHistory).entries({
            priceMaster_ID: priceId,
            oldFinalPrice: existing.finalPrice,
            newFinalPrice: null,
            changeReason: 'Price record deleted',
            changedOn: new Date().toISOString(),
            changedBy: req.user?.id || 'SYSTEM'
        });
    });

    this.after('DELETE', PriceMaster, (data, req) => {
        LOG.info('Price deleted', { priceId: req.data.ID });
    });


    this.before(['CREATE', 'UPDATE', 'DELETE'], PriceHistory, makeReadOnlyGuard('Price History'));
    this.before(['CREATE', 'UPDATE', 'DELETE'], PriceExpiryLog, makeReadOnlyGuard('Price Expiry Log'));


    // on-demand recalculation for a specific record
    this.on('recalculateFinalPrice', async (req) => {
        const { ID } = req.data;

        const price = await SELECT.one.from(PriceMaster).where({ ID });
        if (!price) req.error(404, `Price record ${ID} not found.`);

        const newFinalPrice = computeFinalPrice(price.basePrice, price.discount, price.tax);

        if (newFinalPrice !== price.finalPrice) {
            await INSERT.into(PriceHistory).entries({
                priceMaster_ID: ID,
                oldFinalPrice: price.finalPrice,
                newFinalPrice,
                changeReason: 'Manual recalculation triggered',
                changedOn: new Date().toISOString(),
                changedBy: req.user?.id || 'SYSTEM'
            });

            await UPDATE(PriceMaster).set({ finalPrice: newFinalPrice }).where({ ID });
        }

        LOG.info('Final price recalculated', { priceId: ID, finalPrice: newFinalPrice });

        return {
            ID,
            basePrice: price.basePrice,
            discount: price.discount,
            tax: price.tax,
            finalPrice: newFinalPrice
        };
    });

    // called on a cron by SAP Job Scheduler (also callable manually)
    this.on('expirePrices', async (req) => {
 
        const { ID } = req.data;
console.log(ID);
 
        const today = new Date().toISOString().slice(0, 10);
 
        let expiredCount = 0;
 
        if (ID) {
 
            const oPrice = await SELECT.one .from(PriceMaster) .where({ ID: ID });
 
            if (!oPrice) {
                return req.reject( 404, "Price record not found." );
            }
            // Already expired
           
            if ( oPrice.status === "EXPIRED" || oPrice.active === false ) {
                return req.reject( 400, "The selected price is already inactive or expired." );
            }
           
            // Expire selected record
           
            await UPDATE(PriceMaster).set({ status: "EXPIRED", active: false }).where({ ID: ID });
            expiredCount = 1;
 
            // Create expiry log
           
            await INSERT.into(PriceExpiryLog).entries({ runOn: new Date().toISOString(),
                                                        expiredCount: 1,
                                                        details: "Price record manually marked as EXPIRED.",
                                                        triggeredBy: "MANUAL" });
           
            LOG.info("Manual price expiry executed", { priceId: ID });
            return { expiredCount: 1, message: "Selected price record marked as EXPIRED." };
 
        } else {
 
            const expiredCandidates = await SELECT.from(PriceMaster)
            .where({ validTo: { '<': today }, status: { '!=': 'EXPIRED' } });
 
            if (expiredCandidates.length > 0) {
 
                await UPDATE(PriceMaster).set({ status: 'EXPIRED' })
                    .where({ validTo: { '<': today }, status: { '!=': 'EXPIRED' } });
            }
 
            const expiredCount = expiredCandidates.length;
 
            await INSERT.into(PriceExpiryLog).entries({
                                    runOn: new Date().toISOString(),
                                    expiredCount,
                                    details: `Marked ${expiredCount} price record(s) as EXPIRED.`,
                                    triggeredBy: req.user?.id === 'SYSTEM' ? 'JOB_SCHEDULER' : (req.data.triggeredBy || 'MANUAL')
            });
 
            LOG.info('Expiry job executed', { expiredCount });
 
            return {
                expiredCount,
                message: `${expiredCount} price record(s) marked as EXPIRED.`
            };
        }
       
    });

    this.on('getActivePriceCount', async () => {
        const result = await SELECT.one`count(*) as count`.from(PriceMaster).where({ status: 'ACTIVE' });
        return result ? result.count : 0;
    });

//     this.before("CREATE", "Products", async (req) => {
//     if (!req.data.productName) {
//         return req.reject(400, "Product Name is mandatory.");
//     }

//     const prefix = req.data.productName
//         .trim()
//         .replace(/[^a-zA-Z]/g, "")
//         .substring(0, 3)
//         .toUpperCase();

//     const randomNumber = Math.floor(1000 + Math.random() * 9000);

//     req.data.productCode = `${prefix}-${randomNumber}`;
// });

this.before("CREATE", Warehouses, async (req) => {
        const { city } = req.data;

        if (!city) {
            return req.reject(400, "City is required to generate warehouse code");
        }

        // Chennai -> CH, Hyderabad -> HY, Bangalore -> BA
        const cityPrefix = city
            .trim()
            .split(/\s+/)
            .map(word => word.substring(0, 2))
            .join("")
            .toUpperCase()
            .substring(0, 2);

        const prefix = `WH-${cityPrefix}-`;

        // Find the latest code for this city prefix
        const lastWarehouse = await SELECT.one
            .from(Warehouses)
            .columns("warehouseCode")
            .where({ warehouseCode: { like: `${prefix}%` } })
            .orderBy({ warehouseCode: "desc" });

        let nextNumber = 1;

        if (lastWarehouse?.warehouseCode) {
            const lastNumber = parseInt(
                lastWarehouse.warehouseCode.split("-").pop(),
                10
            );

            nextNumber = lastNumber + 1;
        }

        req.data.warehouseCode =
            `${prefix}${String(nextNumber).padStart(3, "0")}`;
    });

});