import type { NodeLabel } from 'gitnexus-shared';

// Node colors by type - slightly muted for less visual noise
export const NODE_COLORS: Record<NodeLabel, string> = {
  Project: '#a855f7', // Purple - prominent
  Package: '#8b5cf6', // Violet
  Module: '#7c3aed', // Violet darker
  Folder: '#6366f1', // Indigo
  File: '#3b82f6', // Blue
  Class: '#f59e0b', // Amber - stands out
  Function: '#10b981', // Emerald
  Method: '#14b8a6', // Teal
  Variable: '#64748b', // Slate - muted (less important)
  Interface: '#ec4899', // Pink
  Enum: '#f97316', // Orange
  Decorator: '#eab308', // Yellow
  Import: '#475569', // Slate darker - very muted
  Type: '#a78bfa', // Violet light
  CodeElement: '#64748b', // Slate - muted
  Community: '#818cf8', // Indigo light - cluster indicator
  Process: '#f43f5e', // Rose - execution flow indicator
  Section: '#60a5fa', // Blue light - structural section
  Component: '#0ea5e9', // Sky - UI component
  StorageKey: '#22c55e', // Green - app storage state
  Struct: '#f59e0b', // Amber - like Class
  Trait: '#ec4899', // Pink - like Interface
  Impl: '#14b8a6', // Teal - like Method
  TypeAlias: '#a78bfa', // Violet light - like Type
  Const: '#64748b', // Slate - like Variable
  Static: '#64748b', // Slate - like Variable
  Namespace: '#7c3aed', // Violet - like Module
  Union: '#f97316', // Orange - like Enum
  Typedef: '#a78bfa', // Violet light - like Type
  Macro: '#eab308', // Yellow - like Decorator
  Property: '#64748b', // Slate - like Variable
  Record: '#f59e0b', // Amber - like Class
  Delegate: '#14b8a6', // Teal - like Method
  Annotation: '#eab308', // Yellow - like Decorator
  Constructor: '#10b981', // Emerald - like Function
  Template: '#a78bfa', // Violet light - like Type
  Route: '#f43f5e', // Rose - like Process
  Tool: '#a855f7', // Purple - like Project
};

// Node sizes by type - clear visual hierarchy with dramatic size differences
// Structural nodes are MUCH larger to make hierarchy obvious
export const NODE_SIZES: Record<NodeLabel, number> = {
  Project: 20, // Largest - root of everything
  Package: 16, // Major structural element
  Module: 13, // Important container
  Folder: 10, // Structural - clearly bigger than files
  File: 6, // Common element - smaller than folders
  Class: 8, // Important code structure
  Function: 4, // Common code element - small
  Method: 3, // Smaller than function
  Variable: 2, // Tiny - leaf node
  Interface: 7, // Important type definition
  Enum: 5, // Type definition
  Decorator: 2, // Tiny modifier
  Import: 1.5, // Very small - usually hidden anyway
  Type: 3, // Type alias - small
  CodeElement: 2, // Generic small
  Community: 0, // Hidden by default - metadata node
  Process: 0, // Hidden by default - metadata node
  Section: 8, // Structural section - similar to Folder
  Component: 7, // UI component
  StorageKey: 4, // App storage key
  Struct: 8, // Like Class
  Trait: 7, // Like Interface
  Impl: 3, // Like Method
  TypeAlias: 3, // Like Type
  Const: 2, // Like Variable
  Static: 2, // Like Variable
  Namespace: 13, // Like Module
  Union: 5, // Like Enum
  Typedef: 3, // Like Type
  Macro: 2, // Like Decorator
  Property: 2, // Like Variable
  Record: 8, // Like Class
  Delegate: 3, // Like Method
  Annotation: 2, // Like Decorator
  Constructor: 4, // Like Function
  Template: 3, // Like Type
  Route: 5, // Like Enum
  Tool: 5, // Like Enum
};

// Community color palette for cluster-based coloring
export const COMMUNITY_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#14b8a6', // teal
  '#84cc16', // lime
];

export const getCommunityColor = (communityIndex: number): string => {
  return COMMUNITY_COLORS[communityIndex % COMMUNITY_COLORS.length];
};

// Labels to show by default. Keep the initial graph small; users can enable
// additional node types from the filter panel.
export const DEFAULT_VISIBLE_LABELS: NodeLabel[] = ['Class'];

// All filterable labels (in display order)
export const FILTERABLE_LABELS: NodeLabel[] = [
  'Folder',
  'File',
  'Class',
  'Component',
  'StorageKey',
  'Interface',
  'Enum',
  'Type',
  'Function',
  'Method',
  'Variable',
  'Property', // Kotlin/Java field nodes
  'Const',
  'Decorator',
  'Import',
];

// Edge/Relation types
export type EdgeType =
  | 'CONTAINS'
  | 'DEFINES'
  | 'IMPORTS'
  | 'CALLS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'USES_COMPONENT'
  | 'ROUTE_COMPONENT'
  | 'USES_CLASS'
  | 'READS_STORAGE'
  | 'WRITES_STORAGE'
  | 'BINDS_STORAGE';

export const ALL_EDGE_TYPES: EdgeType[] = [
  'CONTAINS',
  'DEFINES',
  'IMPORTS',
  'CALLS',
  'EXTENDS',
  'IMPLEMENTS',
  'USES_COMPONENT',
  'ROUTE_COMPONENT',
  'USES_CLASS',
  'READS_STORAGE',
  'WRITES_STORAGE',
  'BINDS_STORAGE',
];

// Default visible edges (CALLS hidden by default to reduce clutter)
export const DEFAULT_VISIBLE_EDGES: EdgeType[] = [
  'CONTAINS',
  'DEFINES',
  'IMPORTS',
  'EXTENDS',
  'IMPLEMENTS',
  'CALLS',
  'USES_COMPONENT',
  'ROUTE_COMPONENT',
  'USES_CLASS',
  'READS_STORAGE',
  'WRITES_STORAGE',
  'BINDS_STORAGE',
];

// Edge display info for UI
export const EDGE_INFO: Record<EdgeType, { color: string; label: string }> = {
  CONTAINS: { color: '#2d5a3d', label: 'Contains' },
  DEFINES: { color: '#0e7490', label: 'Defines' },
  IMPORTS: { color: '#1d4ed8', label: 'Imports' },
  CALLS: { color: '#7c3aed', label: 'Calls' },
  EXTENDS: { color: '#c2410c', label: 'Extends' },
  IMPLEMENTS: { color: '#be185d', label: 'Implements' },
  USES_COMPONENT: { color: '#0284c7', label: 'Uses component' },
  ROUTE_COMPONENT: { color: '#e11d48', label: 'Route component' },
  USES_CLASS: { color: '#ca8a04', label: 'Uses class' },
  READS_STORAGE: { color: '#16a34a', label: 'Reads storage' },
  WRITES_STORAGE: { color: '#dc2626', label: 'Writes storage' },
  BINDS_STORAGE: { color: '#0891b2', label: 'Binds storage' },
};
