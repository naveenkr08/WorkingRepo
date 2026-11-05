sap.ui.define([
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/m/Dialog",
  "sap/m/Button",
  "sap/m/TextArea",
  "sap/m/Table",
  "sap/m/Column",
  "sap/m/ColumnListItem",
  "sap/m/Text",
  "sap/m/ObjectStatus"
], function (MessageToast, MessageBox, Dialog, Button, TextArea,
             Table, Column, ColumnListItem, Text, ObjectStatus) {
  "use strict";

  var SERVICE_NAMESPACE = "DealerService";

  var APPROVE_ACTION_BY_STATUS = {
    SUBMITTED: "l1Approve",
    L1_APPROVED: "l2Approve"
  };

  // GSTIN: 2-digit state code + 10-character PAN + entity number + "Z" + check character
  var GST_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  var PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]$/;

  /* ---------- helpers ---------- */

  function callBoundAction(oContext, sAction) {
    var oOperation = oContext.getModel().bindContext(
      SERVICE_NAMESPACE + "." + sAction + "(...)",
      oContext
    );
    return oOperation.execute();
  }

  function callBoundActionWithParams(oContext, sAction, mParams) {
    var oOperation = oContext.getModel().bindContext(
      SERVICE_NAMESPACE + "." + sAction + "(...)",
      oContext
    );
    Object.keys(mParams).forEach(function (sKey) {
      oOperation.setParameter(sKey, mParams[sKey]);
    });
    return oOperation.execute();
  }

  function getErrorMessage(oError) {
    return (oError && oError.message) || "Unexpected error";
  }

  function csvCell(vValue) {
    var sValue = String(vValue === null || vValue === undefined ? "" : vValue);
    return '"' + sValue.replace(/"/g, '""') + '"';
  }

  function isActiveRow(oCtx) {
    return oCtx.getProperty("IsActiveEntity") !== false;
  }

  // Opens a dialog asking for a mandatory reason; resolves with the text, or null if cancelled
  function promptReason(sTitle) {
    return new Promise(function (resolve) {
      var oTextArea = new TextArea({
        rows: 4,
        width: "100%",
        placeholder: "Enter reason"
      });

      var oDialog = new Dialog({
        title: sTitle,
        contentWidth: "28rem",
        content: [oTextArea],
        beginButton: new Button({
          text: "Confirm",
          type: "Emphasized",
          press: function () {
            var sText = oTextArea.getValue().trim();
            if (!sText) {
              oTextArea.setValueState("Error").setValueStateText("Reason is required");
              return;
            }
            oDialog.close();
            resolve(sText);
          }
        }),
        endButton: new Button({
          text: "Cancel",
          press: function () {
            oDialog.close();
            resolve(null);
          }
        }),
        afterClose: function () {
          oDialog.destroy();
        }
      });

      oDialog.open();
    });
  }

  // Shared flow for Reject and Block: filter by status, ask for a reason, call the bound action
  function runStatusAction(aContexts, aAllowedStatus, sAction, sTitle, sParam) {
    var aEligible = aContexts.filter(function (oCtx) {
      return isActiveRow(oCtx) && aAllowedStatus.indexOf(oCtx.getProperty("status")) !== -1;
    });

    if (aEligible.length === 0) {
      MessageBox.warning("Select dealer(s) in " + aAllowedStatus.join(" / ") + " status.");
      return;
    }

    promptReason(sTitle + " " + aEligible.length + " dealer(s)").then(function (sReason) {
      if (!sReason) {
        return;
      }

      var mParams = {};
      mParams[sParam] = sReason;

      Promise.allSettled(
        aEligible.map(function (oCtx) {
          return callBoundActionWithParams(oCtx, sAction, mParams);
        })
      ).then(function (aResults) {
        var aErrors = aResults
          .filter(function (r) { return r.status === "rejected"; })
          .map(function (r) { return getErrorMessage(r.reason); });

        if (aErrors.length) {
          MessageBox.error(aErrors.join("\n"));
        } else {
          MessageToast.show(aResults.length + " dealer(s) processed");
        }
        aEligible[0].getBinding().refresh();
      });
    });
  }

  function checkDealer(oData) {
    var sGst = (oData.gstNumber || "").toUpperCase();
    var sPan = (oData.panNumber || "").toUpperCase();
    var bGst = GST_REGEX.test(sGst);
    var bPan = PAN_REGEX.test(sPan);
    return {
      gst: bGst,
      pan: bPan,
      match: bGst && bPan && sGst.substr(2, 10) === sPan
    };
  }

  function statusCell(bOk, sOkText, sFailText) {
    return new ObjectStatus({
      text: bOk ? sOkText : sFailText,
      state: bOk ? "Success" : "Error",
      icon: bOk ? "sap-icon://sys-enter-2" : "sap-icon://error"
    });
  }

  /* ---------- toolbar handlers ---------- */

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

    onReject: function (oBindingContext, aSelectedContexts) {
      runStatusAction(
        aSelectedContexts || [],
        ["SUBMITTED", "L1_APPROVED"],
        "rejectDealer",
        "Reject",
        "remarks"
      );
    },

    onBlock: function (oBindingContext, aSelectedContexts) {
      runStatusAction(
        aSelectedContexts || [],
        ["ACTIVE"],
        "blockDealer",
        "Block",
        "blockedReason"
      );
    },

    onValidate: function (oBindingContext, aSelectedContexts) {
      var aContexts = aSelectedContexts || [];

      if (aContexts.length === 0) {
        MessageToast.show("Select at least one dealer to validate");
        return;
      }

      var iValid = 0;

      var oTable = new Table({
        columns: [
          new Column({ header: new Text({ text: "Dealer Code" }) }),
          new Column({ header: new Text({ text: "Dealer Name" }) }),
          new Column({ header: new Text({ text: "GST Number" }) }),
          new Column({ header: new Text({ text: "GST Format" }) }),
          new Column({ header: new Text({ text: "PAN Number" }) }),
          new Column({ header: new Text({ text: "PAN Format" }) }),
          new Column({ header: new Text({ text: "PAN in GSTIN" }) })
        ]
      });

      aContexts.forEach(function (oCtx) {
        var oData = oCtx.getObject();
        var oResult = checkDealer(oData);

        if (oResult.gst && oResult.pan && oResult.match) {
          iValid++;
        }

        oTable.addItem(new ColumnListItem({
          cells: [
            new Text({ text: oData.dealerCode }),
            new Text({ text: oData.dealerName }),
            new Text({ text: oData.gstNumber }),
            statusCell(oResult.gst, "Valid", "Invalid"),
            new Text({ text: oData.panNumber }),
            statusCell(oResult.pan, "Valid", "Invalid"),
            statusCell(oResult.match, "Matches", "Mismatch")
          ]
        }));
      });

      var oDialog = new Dialog({
        title: "GST / PAN Validation (" + iValid + " of " + aContexts.length + " fully valid)",
        contentWidth: "60rem",
        content: [oTable],
        endButton: new Button({
          text: "Close",
          press: function () {
            oDialog.close();
          }
        }),
        afterClose: function () {
          oDialog.destroy();
        }
      });

      oDialog.open();
    },

    onCopy: function (oBindingContext, aSelectedContexts) {
      var aContexts = aSelectedContexts || [];

      if (aContexts.length === 0) {
        MessageToast.show("Select at least one dealer to copy");
        return;
      }

      var sText = aContexts.map(function (oCtx) {
        var o = oCtx.getObject();
        return [o.dealerCode, o.dealerName, o.gstNumber, o.panNumber, o.phone].join("\t");
      }).join("\n");

      navigator.clipboard.writeText(sText).then(function () {
        MessageToast.show(aContexts.length + " dealer(s) copied");
      }, function () {
        MessageBox.error("Copy failed. The browser blocked clipboard access.");
      });
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