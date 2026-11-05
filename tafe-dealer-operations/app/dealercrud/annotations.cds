using DealerService as service from '../../srv/dealer-service';

annotate service.Dealers with {
    dealerCode    @title: 'Dealer Code'   @Core.Computed;
    dealerName    @title: 'Dealer Name'   @Common.FieldControl: #Mandatory;
    gstNumber     @title: 'GST Number'    @Common.FieldControl: #Mandatory;
    panNumber     @title: 'PAN Number'    @Common.FieldControl: #Mandatory;
    phone         @title: 'Phone'         @Common.FieldControl: #Mandatory;
    email         @title: 'Email';
    dealerType    @title: 'Dealer Type';
    address       @title: 'Address';
    city          @title: 'City';
    state         @title: 'State';
    country       @title: 'Country';
    status        @title: 'Status'        @Core.Computed;
    blockedReason @title: 'Blocked Reason' @Core.Computed;
    remarks       @title: 'Remarks'       @Core.Computed;
    region        @title: 'Region'
        @Common.ValueList: {
            CollectionPath : 'Regions',
            Parameters     : [
                { $Type: 'Common.ValueListParameterInOut',
                  LocalDataProperty: region_ID, ValueListProperty: 'ID' },
                { $Type: 'Common.ValueListParameterDisplayOnly',
                  ValueListProperty: 'regionCode' },
                { $Type: 'Common.ValueListParameterDisplayOnly',
                  ValueListProperty: 'regionName' }
            ]
        }
        @Common.Text: region.regionName
        @Common.TextArrangement: #TextOnly;
};

annotate service.Dealers with @(
    // Hide the standard Create button, the custom "Create Dealer" dialog replaces it
    UI.CreateHidden: true,

    UI.HeaderInfo: {
        TypeName       : 'Dealer',
        TypeNamePlural : 'Dealers',
        Title          : { Value: dealerName },
        Description    : { Value: dealerCode }
    },

    UI.SelectionFields: [ status, dealerType, region_ID ],

    // Table views (wired up in manifest.json under DealersList > views)
    UI.SelectionVariant #All: {
        Text          : 'All Dealers',
        SelectOptions : []
    },

    UI.SelectionVariant #Active: {
        Text          : 'Active Dealers',
        SelectOptions : [
            {
                PropertyName : status,
                Ranges       : [
                    { Sign: #I, Option: #EQ, Low: 'ACTIVE' }
                ]
            }
        ]
    },

    UI.SelectionVariant #Pending: {
        Text          : 'Pending Dealers',
        SelectOptions : [
            {
                PropertyName : status,
                Ranges       : [
                    { Sign: #I, Option: #EQ, Low: 'PENDING' }
                ]
            }
        ]
    },

    UI.SelectionVariant #Rejected: {
        Text          : 'Rejected Dealers',
        SelectOptions : [
            {
                PropertyName : status,
                Ranges       : [
                    { Sign: #I, Option: #EQ, Low: 'REJECTED' }
                ]
            }
        ]
    },

    UI.LineItem: [
        { Value: dealerCode },
        { Value: dealerName },
        { Value: dealerType },
        { Value: gstNumber },
        { Value: panNumber },
        { Value: phone },
        { Value: city },
        { Value: state },
        { Value: status }
    ],

    UI.HeaderFacets: [
        { $Type: 'UI.ReferenceFacet', Label: 'Status',
          Target: '@UI.FieldGroup#HeaderStatus' }
    ],

    UI.FieldGroup #HeaderStatus: { Data: [
        { Value: status },
        { Value: dealerType }
    ]},

    UI.Facets: [
        { $Type: 'UI.ReferenceFacet', ID: 'General',
          Label: 'General Information', Target: '@UI.FieldGroup#General' },
        { $Type: 'UI.ReferenceFacet', ID: 'Tax',
          Label: 'Tax & Contact', Target: '@UI.FieldGroup#TaxContact' },
        { $Type: 'UI.ReferenceFacet', ID: 'Address',
          Label: 'Address', Target: '@UI.FieldGroup#Address' },
        { $Type: 'UI.ReferenceFacet', ID: 'Admin',
          Label: 'Administrative', Target: '@UI.FieldGroup#Admin' }
    ],

    UI.FieldGroup #General: { Data: [
        { Value: dealerCode },
        { Value: dealerName },
        { Value: dealerType },
        { Value: region_ID }
    ]},

    UI.FieldGroup #TaxContact: { Data: [
        { Value: gstNumber },
        { Value: panNumber },
        { Value: phone },
        { Value: email }
    ]},

    UI.FieldGroup #Address: { Data: [
        { Value: address },
        { Value: city },
        { Value: state },
        { Value: country }
    ]},

    UI.FieldGroup #Admin: { Data: [
        { Value: blockedReason },
        { Value: remarks },
        { Value: createdAt },
        { Value: createdBy },
        { Value: modifiedAt },
        { Value: modifiedBy }
    ]}
);

// Region list needs a readable text for the value help
annotate service.Regions with {
    regionCode @title: 'Region Code';
    regionName @title: 'Region Name';
};