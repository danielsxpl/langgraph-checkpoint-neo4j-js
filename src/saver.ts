/**
 * Neo4j Checkpoint Saver for LangGraph.js
 *
 * Provides persistent checkpoint storage using Neo4j with a graph model
 * that supports branching time-travel.
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";
import {
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type SerializerProtocol,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

import { BaseNeo4jSaver } from "./base.js";
import type { Neo4jConfig, Neo4jSaverOptions, CheckpointRecord } from "./types.js";
import {
  CYPHER_CREATE_THREAD_CONSTRAINT,
  CYPHER_CREATE_CHECKPOINT_CONSTRAINT,
  CYPHER_CREATE_CHANNEL_STATE_CONSTRAINT,
  CYPHER_CREATE_BRANCH_CONSTRAINT,
  CYPHER_CREATE_CHECKPOINT_ID_INDEX,
  CYPHER_CREATE_CHECKPOINT_CREATED_INDEX,
  CYPHER_CREATE_BRANCH_NAME_INDEX,
  CYPHER_UPSERT_CHECKPOINT_SIMPLE,
  CYPHER_LINK_PARENT_CHECKPOINT,
  CYPHER_UPSERT_CHANNEL_STATE,
  CYPHER_UPSERT_WRITE,
  CYPHER_GET_CHECKPOINT_BY_ID,
  CYPHER_GET_LATEST_CHECKPOINT,
  CYPHER_GET_ACTIVE_BRANCH_HEAD,
  CYPHER_GET_CHANNEL_STATES,
  CYPHER_GET_WRITES,
  CYPHER_LIST_CHECKPOINTS,
  CYPHER_DELETE_THREAD,
  CYPHER_DELETE_ORPHAN_CHANNEL_STATES,
  CYPHER_CREATE_MAIN_BRANCH,
  CYPHER_THREAD_HAS_BRANCHES,
  CYPHER_UPDATE_BRANCH_HEAD,
} from "./cypher-queries.js";

// Type for channel versions
type ChannelVersions = Record<string, string | number>;

// Type for checkpoint list options
interface CheckpointListOptions {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
}

/**
 * Neo4j checkpoint saver for LangGraph.js
 *
 * Stores checkpoints in Neo4j using a graph model:
 * - (:Thread)-[:HAS_CHECKPOINT]->(:Checkpoint)-[:PREVIOUS]->(:Checkpoint)
 * - (:Checkpoint)-[:HAS_CHANNEL]->(:ChannelState)
 * - (:Checkpoint)-[:HAS_WRITE]->(:PendingWrite)
 *
 * Supports branching time-travel via Branch nodes.
 *
 * @example
 * ```typescript
 * // Using fromConnString (recommended)
 * const checkpointer = Neo4jSaver.fromConnString({
 *   uri: "bolt://localhost:7687",
 *   user: "neo4j",
 *   password: "password"
 * });
 *
 * await checkpointer.setup(); // Create indexes (run once)
 *
 * const graph = createReactAgent({ ... }).compile({
 *   checkpointer
 * });
 *
 * // Don't forget to close when done
 * await checkpointer.close();
 * ```
 */
export class Neo4jSaver extends BaseNeo4jSaver {
  private driver: Driver;
  private database: string | undefined;
  private ownsDriver: boolean;
  private isSetup: boolean = false;

  /**
   * Create a Neo4jSaver instance.
   *
   * @param driver - Neo4j Driver instance
   * @param options - Optional configuration
   */
  constructor(driver: Driver, options?: Neo4jSaverOptions & { serde?: SerializerProtocol }) {
    super(options?.serde);
    this.driver = driver;
    this.database = options?.database;
    this.ownsDriver = false;
  }

  /**
   * Create a Neo4jSaver from connection parameters.
   *
   * This is the recommended way to create a Neo4jSaver.
   *
   * @param config - Neo4j connection configuration
   * @param serde - Optional serializer
   * @returns Configured Neo4jSaver instance
   *
   * @example
   * ```typescript
   * const checkpointer = Neo4jSaver.fromConnString({
   *   uri: "bolt://localhost:7687",
   *   user: "neo4j",
   *   password: "password",
   *   database: "neo4j" // optional
   * });
   * ```
   */
  static fromConnString(config: Neo4jConfig, serde?: SerializerProtocol): Neo4jSaver {
    const driver = neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));

    const saver = new Neo4jSaver(driver, {
      database: config.database,
      serde,
    });
    saver.ownsDriver = true;

    return saver;
  }

  /**
   * Close the driver connection if owned by this instance.
   */
  async close(): Promise<void> {
    if (this.ownsDriver && this.driver) {
      await this.driver.close();
    }
  }

  /**
   * Get a Neo4j session.
   */
  private getSession(): Session {
    return this.driver.session({
      database: this.database,
    });
  }

  /**
   * Create indexes and constraints in Neo4j.
   * Should be called once before using the checkpointer.
   */
  async setup(): Promise<void> {
    if (this.isSetup) return;

    const session = this.getSession();
    try {
      // Create constraints
      await session.run(CYPHER_CREATE_THREAD_CONSTRAINT);
      await session.run(CYPHER_CREATE_CHECKPOINT_CONSTRAINT);
      await session.run(CYPHER_CREATE_CHANNEL_STATE_CONSTRAINT);
      await session.run(CYPHER_CREATE_BRANCH_CONSTRAINT);

      // Create indexes
      await session.run(CYPHER_CREATE_CHECKPOINT_ID_INDEX);
      await session.run(CYPHER_CREATE_CHECKPOINT_CREATED_INDEX);
      await session.run(CYPHER_CREATE_BRANCH_NAME_INDEX);

      this.isSetup = true;
    } finally {
      await session.close();
    }
  }

  /**
   * Store a checkpoint with its configuration and metadata.
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const { threadId, checkpointNs, checkpointId: parentCheckpointId } = this.parseConfig(config);
    const checkpointId = checkpoint.id;

    // Serialize checkpoint and metadata
    const [type, serializedCheckpoint] = await this.dumpCheckpoint(checkpoint);
    const [, serializedMetadata] = await this.dumpMetadata(metadata);

    // Get channel values and versions from checkpoint
    const channelValues = checkpoint.channel_values ?? {};
    const channelVersions = checkpoint.channel_versions ?? {};

    const session = this.getSession();
    try {
      // Step 1: Create Thread and Checkpoint
      await session.run(CYPHER_UPSERT_CHECKPOINT_SIMPLE, {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
        type,
        checkpoint: serializedCheckpoint,
        metadata: serializedMetadata,
      });

      // Step 2: Link to parent checkpoint if exists
      if (parentCheckpointId) {
        await session.run(CYPHER_LINK_PARENT_CHECKPOINT, {
          checkpoint_id: checkpointId,
          parent_checkpoint_id: parentCheckpointId,
        });
      }

      // Step 3: Create ChannelState nodes
      const blobs = await this.dumpBlobs(channelValues, channelVersions);
      for (const blob of blobs) {
        await session.run(CYPHER_UPSERT_CHANNEL_STATE, {
          checkpoint_id: checkpointId,
          channel: blob.channel,
          version: blob.version,
          type: blob.type,
          blob: blob.blob,
        });
      }

      // Step 4: Handle branch management
      const branchResult = await session.run(CYPHER_THREAD_HAS_BRANCHES, {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
      });

      const branchRecord = branchResult.records[0];
      if (branchRecord) {
        const branchCount = branchRecord.get("branch_count");
        const count = typeof branchCount === "object" && "toNumber" in branchCount
          ? branchCount.toNumber()
          : Number(branchCount);

        if (count === 0) {
          // No branches exist, create main branch
          await session.run(CYPHER_CREATE_MAIN_BRANCH, {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            branch_id: crypto.randomUUID(),
          });
        }
      }

      // Update the active branch HEAD
      await session.run(CYPHER_UPDATE_BRANCH_HEAD, {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      });

      return {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
        },
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Store pending writes for fault tolerance.
   */
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { checkpointId } = this.parseConfig(config);

    if (!checkpointId) {
      throw new Error("checkpoint_id is required for putWrites");
    }

    const writeRecords = await this.dumpWrites(writes, taskId);

    const session = this.getSession();
    try {
      for (const record of writeRecords) {
        await session.run(CYPHER_UPSERT_WRITE, {
          checkpoint_id: checkpointId,
          task_id: record.taskId,
          task_path: record.taskPath,
          idx: record.idx,
          channel: record.channel,
          type: record.type,
          blob: record.blob,
        });
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Retrieve a checkpoint tuple by configuration.
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { threadId, checkpointNs, checkpointId } = this.parseConfig(config);

    const session = this.getSession();
    try {
      let result;

      if (checkpointId) {
        // Get specific checkpoint
        result = await session.run(CYPHER_GET_CHECKPOINT_BY_ID, {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: checkpointId,
        });
      } else {
        // Try to get active branch HEAD first
        result = await session.run(CYPHER_GET_ACTIVE_BRANCH_HEAD, {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
        });

        // Fallback to latest checkpoint if no branches
        if (result.records.length === 0) {
          result = await session.run(CYPHER_GET_LATEST_CHECKPOINT, {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
          });
        }
      }

      if (result.records.length === 0) {
        return undefined;
      }

      const record = result.records[0];
      const checkpointRecord: CheckpointRecord = {
        thread_id: record.get("thread_id"),
        checkpoint_ns: record.get("checkpoint_ns"),
        checkpoint_id: record.get("checkpoint_id"),
        parent_checkpoint_id: record.get("parent_checkpoint_id"),
        type: record.get("type"),
        checkpoint: record.get("checkpoint"),
        metadata: record.get("metadata"),
      };

      // Load checkpoint to get channel info
      const checkpoint = await this.loadCheckpoint(
        checkpointRecord.type,
        checkpointRecord.checkpoint
      );

      // Get channel states
      const channelVersions = checkpoint.channel_versions ?? {};
      let channelValues: Record<string, unknown> = {};

      if (Object.keys(channelVersions).length > 0) {
        const channels = Object.keys(channelVersions);
        const versions = Object.values(channelVersions).map(String);

        const blobResult = await session.run(CYPHER_GET_CHANNEL_STATES, {
          checkpoint_id: checkpointRecord.checkpoint_id,
          channels,
          versions,
        });

        const blobRecords = blobResult.records.map((r) => ({
          channel: r.get("channel") as string,
          type: r.get("type") as string,
          blob: r.get("blob") as string,
        }));

        channelValues = await this.loadBlobs(blobRecords);
      }

      // Get pending writes
      const writeResult = await session.run(CYPHER_GET_WRITES, {
        checkpoint_id: checkpointRecord.checkpoint_id,
      });

      const writeRecords = writeResult.records.map((r) => ({
        task_id: r.get("task_id") as string,
        channel: r.get("channel") as string,
        type: r.get("type") as string,
        blob: r.get("blob") as string,
      }));

      const pendingWrites = await this.loadWrites(writeRecords);

      return this.makeCheckpointTuple(checkpointRecord, channelValues, pendingWrites);
    } finally {
      await session.close();
    }
  }

  /**
   * List checkpoints matching the given criteria.
   */
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const { threadId, checkpointNs } = this.parseConfig(config);

    let beforeId: string | null = null;
    if (options?.before) {
      const beforeConfig = this.parseConfig(options.before);
      beforeId = beforeConfig.checkpointId ?? null;
    }

    const limit = options?.limit ?? 100;

    const session = this.getSession();
    try {
      const result = await session.run(CYPHER_LIST_CHECKPOINTS, {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        before_id: beforeId,
        limit: neo4j.int(limit),
      });

      for (const record of result.records) {
        const checkpointRecord: CheckpointRecord = {
          thread_id: record.get("thread_id"),
          checkpoint_ns: record.get("checkpoint_ns"),
          checkpoint_id: record.get("checkpoint_id"),
          parent_checkpoint_id: record.get("parent_checkpoint_id"),
          type: record.get("type"),
          checkpoint: record.get("checkpoint"),
          metadata: record.get("metadata"),
        };

        // For list, we don't load full channel values to save memory
        yield this.makeCheckpointTuple(checkpointRecord, {}, []);
      }
    } finally {
      await session.close();
    }
  }

  /**
   * Delete all checkpoints and writes for a thread.
   */
  async deleteThread(threadId: string): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(CYPHER_DELETE_THREAD, { thread_id: threadId });
      await session.run(CYPHER_DELETE_ORPHAN_CHANNEL_STATES);
    } finally {
      await session.close();
    }
  }
}
