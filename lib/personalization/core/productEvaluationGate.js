"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productEvaluationGateInternals = exports.evaluateProductCoverageGate = void 0;
const reasonCodes_1 = require("./reasonCodes");
const normalizeFactsStatus = (factsStatus) => {
    if (factsStatus === 'full' || factsStatus === 'partial' || factsStatus === 'none') {
        return factsStatus;
    }
    return 'none';
};
const evaluateProductCoverageGate = (input) => {
    const factsStatus = normalizeFactsStatus(input.factsStatus);
    if (factsStatus === 'full') {
        return {
            factsStatus,
            status: 'coverage_ready',
            reasons: [
                (0, reasonCodes_1.buildReason)(reasonCodes_1.REASON_CODES.productCoverageReady, reasonCodes_1.RULE_IDS.productCoverageReady, 'derived', { factsStatus }),
            ],
        };
    }
    return {
        factsStatus,
        status: 'not_enough_structured_data',
        reasons: [
            (0, reasonCodes_1.buildReason)(reasonCodes_1.REASON_CODES.productNotEnoughStructuredData, reasonCodes_1.RULE_IDS.productNotEnoughStructuredData, 'derived', { factsStatus }),
        ],
    };
};
exports.evaluateProductCoverageGate = evaluateProductCoverageGate;
exports.productEvaluationGateInternals = {
    normalizeFactsStatus,
};
