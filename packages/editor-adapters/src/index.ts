/**
 * AF-11 public surface for Skelet editor adapters.
 * Exposes the optional local vector adapter (AF-10) and the optional local
 * raster adapter (AF-11). PageDraw transplant remains a separate conditional
 * future grain (see raster-adapter.ts PageDraw boundary note).
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

export {
  PHOTOCRAFT_PIN,
  RASTER_ADAPTER_ID,
  RASTER_CAPABILITY,
  RASTER_FORMATS,
  RASTER_OPERATIONS,
  TIFF_LAYER_MODES,
  RasterAdapterError,
  buildRasterArgs,
  inspectRaster,
  invokeRaster,
  isRasterError,
  resolveConfinedRasterPath,
  validateRasterAdapterConfig,
  validateRasterBytes,
  validateRasterInput,
  rasterAvailability,
  rasterHealth,
} from "./raster-adapter.ts";
export type {
  Availability as RasterAvailability,
  RasterAdapterConfig,
  RasterCommandsInput,
  RasterConvertInput,
  RasterErrorCode,
  RasterFormat,
  RasterInfoInput,
  RasterInput,
  RasterInspection,
  RasterOperation,
  RasterProvenance,
  RasterRequestor,
  RasterSuccess,
  ResolvedRasterConfig,
  TiffLayerMode,
  ValidatedRasterInput,
} from "./raster-adapter.ts";
