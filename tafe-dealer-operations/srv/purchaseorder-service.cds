using {tafe.dealer as db} from '../db/schema';

service PurchaseOrderService {

    entity PurchaseOrders as projection on db.PurchaseOrders
        actions {

            action submitPO() returns String;

            action approvePO() returns String;

            action rejectPO(reason: String(200)) returns String;
        };

    entity POLineItems as projection on db.POLineItems;

    entity Products as projection on db.Products;

    entity Regions as projection on db.Regions; 

    entity Dealers as projection on db.Dealer;

    entity warehouse as projection on db.Warehouses;
    entity PriceMaster as projection on db.PriceMaster
        actions {

            action expirePrice() returns String;
        };

  
    entity PriceHistory as projection on db.PriceHistory;

 
    entity PriceExpiryLog as projection on db.PriceExpiryLog;

    entity Inventory as projection on db.Inventory;

    // Batch job - expires all PriceMaster records whose validTo has passed
    action runPriceExpiryCheck() returns String;

}
