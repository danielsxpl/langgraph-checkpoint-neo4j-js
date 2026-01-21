/**
 * Type definitions for the Neo4j Checkpoint Saver
 */

import type { Driver, Session } from "neo4j-driver";

/**
 * Configuration for Neo4j connection
 */
export interface Neo4jConfig {
  /** Neo4j connection URI (e.g., "bolt://localhost:7687") */
  uri: string;
  /** Neo4j username */
  user: string;
  /** Neo4j password */
  password: string;
  /** Optional database name (defaults to Neo4j default) */
  database?: string;
}

/**
 * Options for creating a Neo4jSaver instance
 */
export interface Neo4jSaverOptions {
  /** Optional database name */
  database?: string;
}

/**
 * Parsed configuration from RunnableConfig
 */
export interface ParsedConfig {
  threadId: string;
  checkpointNs: string;
  checkpointId: string | undefined;
}

/**
 * Serialized blob data stored in Neo4j
 */
export interface BlobData {
  channel: string;
  version: string;
  type: "json" | "serde";
  blob: string;
}

/**
 * Serialized write record stored in Neo4j
 */
export interface WriteRecord {
  taskId: string;
  taskPath: string;
  idx: number;
  channel: string;
  type: "json" | "serde";
  blob: string;
}

/**
 * Checkpoint record from Neo4j
 */
export interface CheckpointRecord {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string;
  checkpoint: string;
  metadata: string;
}

/**
 * Branch information
 */
export interface BranchInfo {
  branchId: string;
  name: string;
  createdAt: Date;
  forkPointId: string | null;
  isActive: boolean;
  headCheckpointId: string | null;
}

/**
 * Re-export types from neo4j-driver for convenience
 */
export type { Driver, Session };
