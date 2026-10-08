import type { DbTransaction } from "./db.ts";

export interface Flow {
 id: string; sourceId: string; productVersionId: string; title: string; metadata: Record<string,unknown>;
}
export interface FlowStep {
 id: string; flowId: string; position: number; artifactId: string;
 interaction: Record<string,unknown>|null; hotspot: Record<string,unknown>|null;
}
export interface Collection {
 id: string; workspaceId: string; ownerSubject: string; title: string;
 visibility: "private"|"workspace";
}
export type RunStatus="queued"|"running"|"completed"|"partial"|"failed"|"canceled";
export type RunType="capture"|"analysis";
export interface CaptureRun {
 id:string; sourceId:string; status:RunStatus; captureConfig:Record<string,unknown>;
 resourceBudget:Record<string,unknown>; resultEvidence:Record<string,unknown>;
 errorClass:string|null; startedAt:string|null; finishedAt:string|null;
}
export interface AnalysisRun {
 id:string; sourceId:string; captureRunId:string|null; status:RunStatus;
 providerKind:"deterministic"|"model"; providerId:string|null; modelId:string|null;
 egressClass:"none"|"local"|"external"; inputEvidence:Record<string,unknown>;
 resultEvidence:Record<string,unknown>; errorClass:string|null;
 startedAt:string|null; finishedAt:string|null;
}
export interface ImportRecord {
 id:string; sourceId:string; externalId:string; sourceVersion:string;
 canonicalType:"product"|"product_version"|"artifact"|"asset"|"pattern";
 canonicalId:string; metadata:Record<string,unknown>;
}
function requireRow(rows:Record<string,unknown>[]):Record<string,unknown> {
 const row=rows[0]; if(!row) throw new Error("Database operation returned no row"); return row;
}
function obj(v:unknown):Record<string,unknown> {
 return typeof v==="string" ? JSON.parse(v) as Record<string,unknown> :
   v as Record<string,unknown>;
}
function iso(v:unknown):string|null {
 if(v===null||v===undefined) return null;
 const date=v instanceof Date?v:new Date(String(v));
 if(!Number.isFinite(date.getTime())) throw new Error("Invalid run timestamp");
 return date.toISOString();
}
function flow(r:Record<string,unknown>):Flow {
 return {id:String(r.id),sourceId:String(r.source_id),productVersionId:String(r.product_version_id),
  title:String(r.title),metadata:obj(r.metadata)};
}
export async function createFlow(tx:DbTransaction,input:{
 sourceId:string;productVersionId:string;title:string;metadata?:Record<string,unknown>;
}):Promise<Flow> {
 const result=await tx.query(`insert into flows(source_id,product_version_id,title,metadata)
 values($1,$2,$3,$4::jsonb) returning id,source_id,product_version_id,title,metadata`,
 [input.sourceId,input.productVersionId,input.title,JSON.stringify(input.metadata??{})]);
 return flow(requireRow(result.rows));
}
export async function addFlowStep(tx:DbTransaction,input:{
 flowId:string;position:number;artifactId:string;
 interaction?:Record<string,unknown>;hotspot?:Record<string,unknown>;
}):Promise<FlowStep> {
 const res=await tx.query(`insert into flow_steps(flow_id,position,artifact_id,interaction,hotspot)
 values($1,$2,$3,$4::jsonb,$5::jsonb) returning id,flow_id,position,artifact_id,interaction,hotspot`,
 [input.flowId,input.position,input.artifactId,
 input.interaction?JSON.stringify(input.interaction):null,
 input.hotspot?JSON.stringify(input.hotspot):null]);
 return flowStep(requireRow(res.rows));
}
function flowStep(r:Record<string,unknown>):FlowStep {
 return {id:String(r.id),flowId:String(r.flow_id),position:Number(r.position),
  artifactId:String(r.artifact_id),interaction:r.interaction==null?null:obj(r.interaction),
  hotspot:r.hotspot==null?null:obj(r.hotspot)};
}
export async function listFlowSteps(tx:DbTransaction,flowId:string):Promise<FlowStep[]> {
 const r=await tx.query(`select id,flow_id,position,artifact_id,interaction,hotspot
 from flow_steps where flow_id=$1 order by position,id`,[flowId]);
 return r.rows.map(flowStep);
}
function collection(r:Record<string,unknown>):Collection {
 return {id:String(r.id),workspaceId:String(r.workspace_id),ownerSubject:String(r.owner_subject),
  title:String(r.title),visibility:r.visibility as Collection["visibility"]};
}
export async function createCollection(tx:DbTransaction,input:{
 workspaceId:string;ownerSubject:string;title:string;visibility?:"private"|"workspace";
}):Promise<Collection> {
 const r=await tx.query(`insert into collections(workspace_id,owner_subject,title,visibility)
 values($1,$2,$3,$4) returning id,workspace_id,owner_subject,title,visibility`,
 [input.workspaceId,input.ownerSubject,input.title,input.visibility??"private"]);
 return collection(requireRow(r.rows));
}
/** DB-only mutation: future authenticated service MUST authorize collection ownership. */
export async function saveCollectionArtifact(tx:DbTransaction,collectionId:string,artifactId:string):
 Promise<boolean> {
 const r=await tx.query(`insert into collection_items(collection_id,artifact_id)
 values($1,$2) on conflict(collection_id,artifact_id) do nothing returning id`,
 [collectionId,artifactId]);
 return r.rows.length>0;
}
export async function listCollectionArtifacts(tx:DbTransaction,collectionId:string):Promise<string[]> {
 const r=await tx.query(`select artifact_id from collection_items
 where collection_id=$1 order by saved_at,id`,[collectionId]);
 return r.rows.map(x=>String(x.artifact_id));
}
function capture(r:Record<string,unknown>):CaptureRun {
 return {id:String(r.id),sourceId:String(r.source_id),status:r.status as RunStatus,
 captureConfig:obj(r.capture_config),resourceBudget:obj(r.resource_budget),
 resultEvidence:obj(r.result_evidence),errorClass:r.error_class==null?null:String(r.error_class),
 startedAt:iso(r.started_at),finishedAt:iso(r.finished_at)};
}
function analysis(r:Record<string,unknown>):AnalysisRun {
 return {id:String(r.id),sourceId:String(r.source_id),
  captureRunId:r.capture_run_id==null?null:String(r.capture_run_id),
  status:r.status as RunStatus,providerKind:r.provider_kind as AnalysisRun["providerKind"],
  providerId:r.provider_id==null?null:String(r.provider_id),
  modelId:r.model_id==null?null:String(r.model_id),
  egressClass:r.egress_class as AnalysisRun["egressClass"],
  inputEvidence:obj(r.input_evidence),resultEvidence:obj(r.result_evidence),
  errorClass:r.error_class==null?null:String(r.error_class),
  startedAt:iso(r.started_at),finishedAt:iso(r.finished_at)};
}
export async function createCaptureRun(tx:DbTransaction,input:{
 sourceId:string;captureConfig?:Record<string,unknown>;resourceBudget?:Record<string,unknown>;
}):Promise<CaptureRun> {
 const r=await tx.query(`insert into capture_runs(source_id,capture_config,resource_budget)
 values($1,$2::jsonb,$3::jsonb) returning *`,
 [input.sourceId,JSON.stringify(input.captureConfig??{}),JSON.stringify(input.resourceBudget??{})]);
 return capture(requireRow(r.rows));
}
export async function createAnalysisRun(tx:DbTransaction,input:{
 sourceId:string;captureRunId?:string;providerKind:"deterministic"|"model";
 providerId?:string;modelId?:string;egressClass:"none"|"local"|"external";
 inputEvidence?:Record<string,unknown>;
}):Promise<AnalysisRun> {
 const r=await tx.query(`insert into analysis_runs
 (source_id,capture_run_id,provider_kind,provider_id,model_id,egress_class,input_evidence)
 values($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`,
 [input.sourceId,input.captureRunId??null,input.providerKind,input.providerId??null,
 input.modelId??null,input.egressClass,JSON.stringify(input.inputEvidence??{})]);
 return analysis(requireRow(r.rows));
}
export async function getCaptureRun(tx:DbTransaction,id:string):Promise<CaptureRun|null> {
 const r=await tx.query("select * from capture_runs where id=$1",[id]);
 return r.rows[0]?capture(r.rows[0]):null;
}
export async function getAnalysisRun(tx:DbTransaction,id:string):Promise<AnalysisRun|null> {
 const r=await tx.query("select * from analysis_runs where id=$1",[id]);
 return r.rows[0]?analysis(r.rows[0]):null;
}
/** Concurrency-safe guarded transitions; no completed state without concrete evidence. */
export async function transitionRun(tx:DbTransaction,type:RunType,id:string,
 expected:RunStatus,next:RunStatus,options?:{
 evidence?:Record<string,unknown>;errorClass?:string;
}):Promise<CaptureRun|AnalysisRun> {
 if (!((expected==="queued"&&(next==="running"||next==="canceled")) ||
      (expected==="running"&&["completed","partial","failed","canceled"].includes(next)))) {
  throw new Error("Invalid requested run transition");
 }
 if (next==="completed" && (!options?.evidence || Object.keys(options.evidence).length===0)) {
  throw new Error("Completed run needs observed evidence");
 }
 if (next==="failed" && !options?.errorClass?.trim()) {
  throw new Error("Failed run needs error classification");
 }
 const table=type==="capture"?"capture_runs":"analysis_runs";
 const r=await tx.query(`update ${table} set
  status=$3,
  started_at=case when $3='running' then now() else started_at end,
  finished_at=case when $3 in ('completed','partial','failed','canceled') then now() else null end,
  result_evidence=case when $4::jsonb is not null then $4::jsonb else result_evidence end,
  error_class=$5
  where id=$1 and status=$2 returning *`,
  [id,expected,next,options?.evidence?JSON.stringify(options.evidence):null,
   options?.errorClass??null]);
 if (!r.rows[0]) throw new Error("Run transition rejected by optimistic status guard");
 return type==="capture"?capture(r.rows[0]):analysis(r.rows[0]);
}
function importRecord(r:Record<string,unknown>):ImportRecord {
 return {id:String(r.id),sourceId:String(r.source_id),externalId:String(r.external_id),
 sourceVersion:String(r.source_version),canonicalType:r.canonical_type as ImportRecord["canonicalType"],
 canonicalId:String(r.canonical_id),metadata:obj(r.metadata)};
}
export async function registerImport(tx:DbTransaction,input:{
 sourceId:string;externalId:string;sourceVersion:string;
 canonicalType:ImportRecord["canonicalType"];canonicalId:string;
 metadata?:Record<string,unknown>;
}):Promise<{record:ImportRecord;created:boolean}> {
 const r=await tx.query(`insert into import_records
 (source_id,external_id,source_version,canonical_type,canonical_id,metadata)
 values($1,$2,$3,$4,$5,$6::jsonb)
 on conflict(source_id,external_id,source_version) do nothing returning *`,
 [input.sourceId,input.externalId,input.sourceVersion,input.canonicalType,
 input.canonicalId,JSON.stringify(input.metadata??{})]);
 if (r.rows[0]) return {record:importRecord(r.rows[0]),created:true};
 const existing=await tx.query(`select * from import_records
 where source_id=$1 and external_id=$2 and source_version=$3`,
 [input.sourceId,input.externalId,input.sourceVersion]);
 const value=importRecord(requireRow(existing.rows));
 if(value.canonicalType!==input.canonicalType || value.canonicalId!==input.canonicalId) {
  throw new Error("Conflicting canonical identity for source import record");
 }
 return {record:value,created:false};
}
