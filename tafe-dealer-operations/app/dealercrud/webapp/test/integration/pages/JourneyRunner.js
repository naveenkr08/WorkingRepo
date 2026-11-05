sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"dc/dealercrud/test/integration/pages/DealersList.gen",
	"dc/dealercrud/test/integration/pages/DealersObjectPage.gen"
], function (JourneyRunner, DealersListGenerated, DealersObjectPageGenerated) {
    'use strict';

    const runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('dc/dealercrud') + '/test/flp.html#app-preview',
        pages: {
			onTheDealersListGenerated: DealersListGenerated,
			onTheDealersObjectPageGenerated: DealersObjectPageGenerated
        },
        async: true
    });

    return runner;
});

