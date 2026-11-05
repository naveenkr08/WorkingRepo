using {tafe.dealer as db} from '../db/schema';

service DealerService {

   @odata.draft.enabled
    entity Dealers as projection on db.Dealer {
        *
    } actions {

        action submitDealer() returns String;

        action l1Approve(remarks: String(500)) returns String;

        action l2Approve(remarks: String(500)) returns String;

        action rejectDealer(reason: String(200)) returns String;

        action blockDealer(
            reason: String(200),
            remarks: String(500)
        ) returns String;
    };

    entity Regions as projection on db.Regions;

    entity DealerDocuments as projection on db.DealerDocuments;

    entity Products as projection on db.Products;

    entity OnboardingApprovals as projection on db.OnboardingApprovals;

    function getCitiesByState(state: String) returns array of String;

    type GeocodeResult {
        latitude    : Double;
        longitude   : Double;
        displayName : String;
    }

    function geocodeAddress(query: String) returns GeocodeResult;

    // ------------------------------------------------------------
    // Actions called by SAP Build Process Automation (BPA).
    // Unbound, so BPA only needs the dealerId from the trigger
    // context and not the two-part draft key of the bound actions.
    // ------------------------------------------------------------

    action bpaL1Approve(dealerId: UUID, remarks: String(500)) returns String;

    action bpaL2Approve(dealerId: UUID, remarks: String(500)) returns String;

    action bpaReject(dealerId: UUID, reason: String(200)) returns String;
}
