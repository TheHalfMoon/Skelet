/**
 * AF-10 public surface for Skelet editor adapters.
 * Currently exposes only the optional local vector adapter; raster and
 * PageDraw adapters remain separate future grains.
 */

export {
  VECTOR_ADAPTER_ID,
  VECTOR_CAPABILITY,
  VECTOR_OPERATIONS,
  VECTORCRAFT_PIN,
  VectorAdapterError,
  buildVectorArgs,
  inspectSvg,
  invokeVector,
  isVectorError,
  resolveConfinedPath,
  tokensToSvg,
  validateSvgOutput,
  validateVectorAdapterConfig,
  validateVectorInput,
  vectorAvailability,
  vectorHealth,
} from "./vector-adapter.ts";
export type {
  Availability,
  ResolvedVectorConfig,
  SvgInspection,
  TokenSwatchInput,
  ValidatedVectorInput,
  VectorAdapterConfig,
  VectorConvertInput,
  VectorCommandsInput,
  VectorErrorCode,
  VectorInfoInput,
  VectorInput,
  VectorOperation,
  VectorProvenance,
  VectorRequestor,
  VectorSuccess,
} from "./vector-adapter.ts";
