'use strict';

let boqItems    = [];  // Array<{no, desc, unit, qty, rate, price, cat, isLabour, labourTypes, tradeCode, regSource, …}>
let priceData   = {};  // { itemNo: {suppliers, bestIdx, recommendation, savingPct, marketNote} }
let labourData  = {};  // { itemNo: labourBreakdown }
let excludedRows = []; // Rows classified as summary/heading/narrative — shown in review tab 2
let compChecks  = [];
let meta        = { title:'', rfq:'', client:'', vat:0.15 };
