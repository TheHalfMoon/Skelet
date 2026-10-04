# Skelet Product Contract

Status: canonical product charter for implementation

## Mission

Skelet is the design intelligence layer for humans and AI agents.

The product must help users and agents discover real design evidence, understand why it works, retrieve the right assets, analyze existing products, and reuse that evidence in implementation workflows.

Skelet is not defined as a cheaper Mobbin clone. The commercial model may target approximately half the price of equivalent Mobbin plans, but product differentiation must come from agent-native design intelligence, broader asset coverage, URL analysis, provenance, and reusable machine-readable context.

## Primary Users

1. AI coding and design agents.
2. Developers building product interfaces with agents.
3. Product designers and design engineers.
4. Product teams researching shipped patterns and flows.
5. Teams that need reusable design evidence, assets, and implementation context.

AI agents are first-class users. Anything a human can discover in the Skelet UI must have a stable structured representation that can be retrieved through the API/MCP layer.

## Product Surfaces

### Research

Research covers products, product versions, apps, websites, screens, flows, patterns, copy, components, and evidence-backed comparisons.

### Assets

Assets covers icons, logos, fonts, components, illustrations, and reusable design resources. Results must include provenance and rights metadata, not only downloadable files.

### Lens

Lens accepts a URL or image and returns a structured design intelligence pack including screenshots, page structure, design tokens, brand assets, technology clues, quality findings, and agent-ready context.

### Agents

The agent platform includes Remote MCP, MCP Apps, Agent Skills, REST APIs, SDKs, and CLI access. Agent workflows must not require scraping the Skelet web UI.

### Create

Create turns qualified Skelet references into editable design output through OpenPencil or another qualified provider. Skelet must not build a new canvas engine unless evidence later proves that existing providers cannot meet product requirements.

## Launch-Critical Journeys

- Search screens, flows, websites, components, icons, logos, fonts, and patterns from one search surface.
- Paste a public URL and receive a reproducible design intelligence report.
- Connect an AI agent and search, inspect, compare, save, and package design evidence without using the web UI.
- Save research to workspace collections and resume it from another client or agent.
- Retrieve machine-usable assets with provenance, rights metadata, variants, and source references.
- Create compact reference packs that another agent can recover entirely from stable Skelet IDs or URIs.

## Commercial Launch Scope

The minimum paid launch includes:

- unified search;
- qualified Research corpus with products, sites, screens, and flows;
- Assets with icons, logos, fonts, and components;
- Lens URL analysis;
- collections and reference packs;
- Remote MCP, Agent Skills, and core REST APIs;
- auth, workspaces, and billing;
- provenance and rights display.

## Non-Goals for Initial Launch

- Rebuild Figma.
- Build a custom canvas engine.
- Build a mobile device farm before demand is proven.
- Make paid LLM inference mandatory.
- Make a paid crawler, search SaaS, vector SaaS, GPU, or cloud API mandatory.
- Become a generic web scraping product unrelated to design intelligence.
- Import donor complexity that can remain behind a provider adapter.

## Product Quality Bar

Skelet must prefer evidence over generated claims. Analysis output must distinguish observed facts, deterministic inference, heuristic inference, and model-generated interpretation.

A result without recoverable source identity is incomplete. An agent output without stable Skelet IDs or URIs is incomplete. An imported asset without provenance and a serving policy is incomplete.

## Definition of Ready

Skelet v1 is commercially ready when an authenticated agent can connect, search real design evidence, inspect structured objects, compare references, retrieve provenance, save evidence, create a reference pack, hand it to another agent, and recover every referenced object without scraping the Skelet web UI.
