namespace tafe.dealer;

using { cuid, managed } from '@sap/cds/common';


/* =========================================================
   DEALER STATUS
   ========================================================= */

type DealerStatus : String enum {
    PENDING;
    SUBMITTED;
    L1_APPROVED;
    ACTIVE;
    REJECTED;
    BLOCKED;
    INACTIVE;
}

type PricingStatus : String enum {
    DRAFT;
    PENDING;
    SUBMITTED;
    ACTIVE;
    REJECTED;
    EXPIRED;
    INACTIVE;
}
type DealerType : String enum {
    DEALER;
    DISTRIBUTOR;
    RETAILER;
}
entity Dealer : cuid, managed {

    dealerCode : String(20);

    dealerName : String(100) @mandatory;

    gstNumber : String(15) @mandatory;

    panNumber : String(10) @mandatory;

    phone : String(10) @mandatory;

    email : String(100);

    address : String(250);

    city : String(50);

    state : String(50);
    
    region : Association to Regions;

    country : String(50);

    dealerType : DealerType;

    status : DealerStatus default 'PENDING';

    blockedReason : String(200);

    remarks : String(500);
    documents : Composition of many DealerDocuments
        on documents.dealer = $self;

    approvalHistory : Composition of many OnboardingApprovals
        on approvalHistory.dealer = $self;

    purchase : Composition of many PurchaseOrders on purchase.dealer=$self
    
}

entity DealerDocuments : cuid {

    documentType : String(50);

    fileName : String(100);

    mimeType : String(100);

    dealer : Association to Dealer;
}



entity OnboardingApprovals : cuid, managed {

    action : String(30);

    level : Integer;

    remarks : String(500);

    actionBy : String(100);

    actionAt : DateTime;

    dealer : Association to Dealer;
}

entity PurchaseOrders : cuid, managed {

    poNumber : String(30);

    orderDate : Date;

    totalAmount : Decimal(15,2) default 0;

    taxAmount : Decimal(15,2) default 0;

    status : String enum{
            APPROVED;
            PENDING;
            DELIVERED;
            SUBMITTED;
            REJECT
    } ;

    rejectionReason : String(255);

    dealer : Association to Dealer;

   // warehouse : Association to Warehouses;

    items : Composition of many POLineItems
        on items.purchaseOrder = $self;
}


entity POLineItems : cuid {

    quantity : Integer;

    unitPrice : Decimal(15,2);

    lineTotal : Decimal(15,2);

    product : Association to Products;

    purchaseOrder : Association to PurchaseOrders;
}

entity Products : cuid, managed {

    productCode : String(20) ;

    productName : String(100) @mandatory;

    category : String(50);

    active : Boolean default false;

    unitPrice : Decimal(15,2);

    prices : Association to many PriceMaster
        on prices.product = $self;

    inventory : Association to many Inventory
        on inventory.product = $self;
}


/* =========================================================
   REGIONS
   ========================================================= */

entity Regions : cuid {

    regionCode : String(10) @mandatory;

    regionName : String(50) @mandatory;

    dealers : Association to many Dealer on dealers.region = $self; 

    totalPurchaseValue : Integer;
}


/* =========================================================
   PRICE MASTER
   ========================================================= */

entity PriceMaster : cuid, managed {
// gst, transportation - based on region , net price 
    basePrice : Decimal(15,2) @mandatory;

    discount : Decimal(15,2) default 0; // based on Dealer

    tax : Decimal(15,2) default 0;

    finalPrice : Decimal(15,2);

    region : Association to Regions;

    validFrom : Date @mandatory;

    validTo : Date @mandatory;

    status : PricingStatus default 'DRAFT';

    product : Association to Products @mandatory;

    history : Association to many PriceHistory
        on history.priceMaster = $self;
}


/* =========================================================
   PRICE HISTORY
   ========================================================= */

entity PriceHistory : cuid {

    priceMaster : Association to PriceMaster;

    oldFinalPrice : Decimal(15,2);

    newFinalPrice : Decimal(15,2);

    changeReason : String(100);

    changedOn : DateTime;

    changedBy : String(100);
}


/* =========================================================
   PRICE EXPIRY LOG
   ========================================================= */

entity PriceExpiryLog : cuid {

    runOn : DateTime;

    expiredCount : Integer;
    details      : LargeString;
    triggeredBy  : String(50); 
}

type InventoryStatus : String enum {
    AVAILABLE;
    LOW_STOCK;
    OUT_OF_STOCK;
    RESERVED;
    INACTIVE;
}

/* =========================================================
   WAREHOUSES
   ========================================================= */

entity Warehouses : cuid, managed {
 @assert.unique: { warehouseCode: [warehouseCode] }
    warehouseCode : String(20) ;

    warehouseName : String(100) @mandatory;

    address : String(250);

    city : String(50);

    state : String(50);

    region : String(20);

    country : String(50);

    active : Boolean default true;

    inventory : Association to many Inventory
        on inventory.warehouse = $self;
}

/* =========================================================
   INVENTORY / STOCK
   ========================================================= */

entity Inventory : cuid, managed {

    product : Association to Products @mandatory;

    warehouse : Association to Warehouses @mandatory;

    availableQuantity : Integer default 0;

    reservedQuantity : Integer default 0;

    reorderLevel : Integer default 0;

    status : InventoryStatus default 'AVAILABLE';

    lastStockUpdate : DateTime;

    remarks : String(250);
}
