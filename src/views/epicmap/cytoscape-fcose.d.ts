// cytoscape-fcose ships no types; it is a plain Cytoscape extension.
declare module "cytoscape-fcose" {
  import type { Ext } from "cytoscape";
  const fcose: Ext;
  export default fcose;
}
