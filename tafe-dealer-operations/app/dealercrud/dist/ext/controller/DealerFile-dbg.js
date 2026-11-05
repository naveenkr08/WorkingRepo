sap.ui.define([
  "sap/m/MessageToast",
  "sap/m/MessageBox"
], function (MessageToast, MessageBox) {
  "use strict";

  
  var SERVICE_NAMESPACE = "DealerService";

  // Status -> action that moves the dealer one step forward
  var APPROVE_ACTION_BY_STATUS = {
    SUBMITTED: "l1Approve",     // -> L1_APPROVED
    L1_APPROVED: "l2Approve"    // -> ACTIVE (set by backend)
  };
  function callBoundAction(oContext, sAction) {
    var oOperation = oContext.getModel().bindContext(
      SERVICE_NAMESPACE + "." + sAction + "(...)",
      oContext
    );
    return oOperation.execute();
  }

  function getErrorMessage(oError) {
    return (oError && oError.message) || "Unexpected error";
  }

  function csvCell(vValue) {
    var sValue = String(vValue === null || vValue === undefined ? "" : vValue);
    return '"' + sValue.replace(/"/g, '""') + '"';
  }

  // Skip draft rows, only active entities take part in the workflow
  function isActiveRow(oCtx) {
    return oCtx.getProperty("IsActiveEntity") !== false;
  }

  return {

  
    onSubmitDealers: function (oBindingContext, aSelectedContexts) {
      var aContexts = aSelectedContexts || [];

      var aEligible = aContexts.filter(function (oCtx) {
        return isActiveRow(oCtx) && oCtx.getProperty("status") === "PENDING";
      });

      if (aEligible.length === 0) {
        MessageBox.warning("Select at least one dealer in PENDING status.");
        return;
      }

      MessageBox.confirm(
        "Submit " + aEligible.length + " dealer(s) for approval?",
        {
          onClose: function (sAction) {
            if (sAction !== MessageBox.Action.OK) {
              return;
            }

            Promise.allSettled(
              aEligible.map(function (oCtx) {
                return callBoundAction(oCtx, "submitDealer");
              })
            ).then(function (aResults) {
              var iFailed = aResults.filter(function (r) {
                return r.status === "rejected";
              }).length;

              MessageToast.show(
                (aResults.length - iFailed) + " submitted, " + iFailed + " failed"
              );
              aEligible[0].getBinding().refresh();
            });
          }
        }
      );
    },

    
    onApprove: function (oBindingContext, aSelectedContexts) {
      var aContexts = aSelectedContexts || [];

      var aPending = aContexts.filter(function (oCtx) {
        return oCtx.getProperty("status") === "PENDING";
      });

      var aEligible = aContexts.filter(function (oCtx) {
        return isActiveRow(oCtx) && !!APPROVE_ACTION_BY_STATUS[oCtx.getProperty("status")];
      });

      if (aEligible.length === 0) {
        MessageBox.warning(
          aPending.length
            ? "Selected dealer(s) are PENDING. Submit them for approval first."
            : "None of the selected dealers are awaiting approval."
        );
        return;
      }

      var iSkipped = aContexts.length - aEligible.length;

      MessageBox.confirm(
        "Approve " + aEligible.length + " dealer(s)?" +
          (iSkipped ? "\n" + iSkipped + " will be skipped (not awaiting approval)." : ""),
        {
          onClose: function (sAction) {
            if (sAction !== MessageBox.Action.OK) {
              return;
            }

            Promise.allSettled(
              aEligible.map(function (oCtx) {
                var sActionName = APPROVE_ACTION_BY_STATUS[oCtx.getProperty("status")];
                return callBoundAction(oCtx, sActionName);
              })
            ).then(function (aResults) {
              var aErrors = aResults
                .filter(function (r) { return r.status === "rejected"; })
                .map(function (r) { return getErrorMessage(r.reason); });

              if (aErrors.length) {
                MessageBox.error(aErrors.join("\n"));
              } else {
                MessageToast.show(aResults.length + " dealer(s) moved to next approval step");
              }
              aEligible[0].getBinding().refresh();
            });
          }
        }
      );
    },

   
    onExport: function (oBindingContext, aSelectedContexts) {
      var aContexts = aSelectedContexts || [];

      if (aContexts.length === 0) {
        MessageToast.show("Select at least one dealer to export");
        return;
      }

      var aColumns = [
        "dealerCode", "dealerName", "dealerType", "gstNumber", "panNumber",
        "phone", "email", "city", "state", "country", "status"
      ];

      var aRows = [aColumns.map(csvCell).join(",")];

      aContexts.forEach(function (oCtx) {
        var oData = oCtx.getObject();
        aRows.push(
          aColumns.map(function (sCol) { return csvCell(oData[sCol]); }).join(",")
        );
      });

      var oBlob = new Blob(["\ufeff" + aRows.join("\n")], {
        type: "text/csv;charset=utf-8;"
      });
      var sUrl = URL.createObjectURL(oBlob);
      var oLink = document.createElement("a");
      oLink.href = sUrl;
      oLink.download = "dealers_" + new Date().toISOString().slice(0, 10) + ".csv";
      document.body.appendChild(oLink);
      oLink.click();
      document.body.removeChild(oLink);
      URL.revokeObjectURL(sUrl);

      MessageToast.show(aContexts.length + " dealer(s) exported");
    }
  };
});