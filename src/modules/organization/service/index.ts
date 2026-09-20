/**
 * Public surface of the Organization application/service layer (Phase 1,
 * queued prompt 3). The api layer (server actions) and tests import from
 * here; nothing outside this folder reaches for Prisma directly.
 */
export { callerFromUser, type OrgCaller } from "./caller";
export {
  OrgAppError,
  serializeOrgAppError,
  toOrgAppError,
  type OrgAppErrorCode,
  ORG_ERROR_STATUS,
} from "./app-errors";
export {
  assertCallerCanManageOrg,
  assertVersionMatches,
  notFound,
  transactWithAudit,
} from "./mutations";
export {
  validateEffectivePeriod,
  loadActivePeriods,
  validateStructuralParent,
  validateStructuralParentForCreate,
  validateLifecycleChange,
  validatePositionStatusChange,
  validatePositionPlacement,
  validateReportingEdge,
  assertOrgAccess,
  type OrgSubject,
  type ScopeCheckResult,
} from "./validation-service";
export {
  createTreeNode,
  updateTreeNode,
  archiveTreeNode,
  setTreeNodeStatus,
  createClassification,
  updateClassification,
  archiveClassification,
  type TreeNodeInput,
  type TreeNodeUpdateInput,
  type ClassificationInput,
} from "./structure-service";
export {
  createLegalEntity,
  updateLegalEntity,
  archiveLegalEntity,
  createCostCenter,
  updateCostCenter,
  archiveCostCenter,
  createLocation,
  updateLocation,
  archiveLocation,
  createFacility,
  updateFacility,
  archiveFacility,
  type LegalEntityInput,
  type LocationInput,
  type FacilityInput,
} from "./entity-service";
export {
  createPosition,
  updatePosition,
  setPositionStatus,
  createReportingEdge,
  closeReportingEdge,
  type PositionInput,
  type ReportingEdgeInput,
} from "./position-service";
