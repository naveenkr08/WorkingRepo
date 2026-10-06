namespace tafe.dealer;
 
using { tafe.dealer as db } from '../db/schema';
 
 
service analyticsService {

    /* =========================================================
   1. DEALER ANALYTICS
   Source: Dealer + PurchaseOrders
   Purpose: PO count, revenue, and status breakdown per dealer
   ========================================================= */
 
    @readonly
    entity DealerAnalytics as select from db.PurchaseOrders {
        key dealer.ID          as dealerId       : UUID,
            dealer.dealerCode  as dealerCode     : String(20),
            dealer.dealerName  as dealerName     : String(100),
            dealer.city        as city           : String(50),
            dealer.state       as state          : String(50),
        key status              as status         : String,
            count(*)           as totalOrders    : Integer,
            sum(totalAmount)   as totalRevenue   : Decimal(15,2),
            sum(taxAmount)     as totalTax       : Decimal(15,2)
    } group by
        dealer.ID,
        dealer.dealerCode,
        dealer.dealerName,
        dealer.city,
        dealer.state,
        status;
    
    
    /* =========================================================
    2. MONTHLY ANALYTICS
    Source: PurchaseOrders
    Purpose: Orders and revenue trend grouped by month
    ========================================================= */
    
    @readonly
    entity MonthlyAnalytics as select from db.PurchaseOrders {
        key year(orderDate)     as orderYear      : Integer,
        key month(orderDate)    as orderMonth     : Integer,
            count(*)            as orderCount     : Integer,
            sum(totalAmount)    as monthlyRevenue : Decimal(15,2),
            sum(taxAmount)      as monthlyTax     : Decimal(15,2),
            avg(totalAmount)    as avgOrderValue  : Decimal(15,2)
    } group by
        year(orderDate),
        month(orderDate);
    
    
    /* =========================================================
    3. PRICING ANALYTICS
    Source: PriceMaster + Products + PriceHistory
    Purpose: Current price, discount %, and change trend per product
    ========================================================= */
    
    @readonly
    entity PricingAnalytics as select from db.PriceMaster {
        key ID                   as ID             : UUID,
            product.ID           as productId      : UUID,
            product.productCode  as productCode    : String(20),
            product.productName  as productName    : String(100),
            product.category     as category       : String(50),
            region.regionName    as regionName     : String(50),
            basePrice,
            discount,
            tax,
            finalPrice,
            validFrom,
            validTo,
            status               as priceStatus    : String(20)
    };
    
    @readonly
    entity PricingTrendAnalytics as select from db.PriceHistory {
        key ID                              as ID             : UUID,
            priceMaster.ID                  as priceMasterId  : UUID,
            priceMaster.product.productCode as productCode    : String(20),
            priceMaster.product.productName as productName    : String(100),
            oldFinalPrice,
            newFinalPrice,
            (newFinalPrice - oldFinalPrice) as priceDelta     : Decimal(15,2),
            changeReason,
            changedOn,
            changedBy
    };
    
    
    /* =========================================================
    4. PRODUCT SALES ANALYTICS
    Source: Products + POLineItems
    Purpose: Quantity sold and revenue per product
    ========================================================= */
    
    @readonly
    entity ProductSalesAnalytics as select from db.POLineItems {
        key product.ID           as productId    : UUID,
            product.productCode  as productCode  : String(20),
            product.productName  as productName  : String(100),
            product.category     as category     : String(50),
            sum(quantity)        as totalQtySold : Integer,
            sum(lineTotal)       as totalRevenue : Decimal(15,2),
            avg(unitPrice)       as avgUnitPrice : Decimal(15,2)
    } group by
        product.ID,
        product.productCode,
        product.productName,
        product.category;
    
    
    /* =========================================================
    5. PURCHASE ORDER ANALYTICS
    Source: PurchaseOrders + POLineItems
    Purpose: Status distribution, average order value, tax totals
    ========================================================= */
    
    @readonly
    entity PurchaseOrderAnalytics as select from db.PurchaseOrders {
        key ID              as orderId       : UUID,
            poNumber,
            orderDate,
            dealer.dealerCode as dealerCode  : String(20),
            dealer.dealerName as dealerName  : String(100),
            status,
            totalAmount,
            taxAmount,
            rejectionReason
    };
    
    @readonly
    entity PurchaseOrderStatusSummary as select from db.PurchaseOrders {
        key status           as status        : String,
            count(*)         as orderCount    : Integer,
            sum(totalAmount) as totalValue    : Decimal(15,2),
            avg(totalAmount) as avgOrderValue : Decimal(15,2)
    } group by status;

}

