using { tafe.dealer as db } from '../db/schema';

service InventoryService @(path: '/inventory') {

    entity Inventory as projection on db.Inventory;

    entity Warehouses as projection on db.Warehouses;

    entity Products as projection on db.Products;

    action reserveStock(
        productID : UUID,
        warehouseID : UUID,
        quantity : Integer
    ) returns String;

    action releaseStock(
        productID : UUID,
        warehouseID : UUID,
        quantity : Integer
    ) returns String;

    function getAvailableStock(
        productID : UUID,
        warehouseID : UUID
    ) returns Integer;
}