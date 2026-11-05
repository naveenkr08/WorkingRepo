using { tafe.dealer as db } from '../db/schema';

service PricingService @(path: '/pricing') {

    entity Products as projection on db.Products;

    entity PriceMaster as projection on db.PriceMaster;

    entity Regions as projection on db.Regions;

   
    entity PriceHistory as projection on db.PriceHistory;

 
    entity PriceExpiryLog as projection on db.PriceExpiryLog;

    action recalculateFinalPrice(ID: UUID) returns {
        ID         : UUID;
        basePrice  : Decimal(15,2);
        discount   : Decimal(15,2);
        tax        : Decimal(15,2);
        finalPrice : Decimal(15,2);
    };

    //  entry point called by SAP Job Scheduler on a cron schedule
    action expirePrices(ID:UUID) returns {
        expiredCount : Integer;
        message      : String;
    };

    function getActivePriceCount() returns Integer;
}
