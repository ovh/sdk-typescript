// SPDX-FileCopyrightText: 2026 OVH SAS
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Everything the generated sections use from the core, in one module.
 *
 * Generated code imports this module only (`../../core/gen.js`), with relative imports. A
 * name here is a contract with the templates: rename it only together with them.
 *
 * @module
 */

export { Client, type ClientOptions } from "./client.js";
export type { RequestOptions } from "./engine.js";
export { type Operation, Registry, type SectionLoader } from "./registry.js";
export { SectionApi } from "./section.js";
