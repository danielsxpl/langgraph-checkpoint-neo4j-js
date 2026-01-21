/**
 * Base class for Neo4j checkpoint savers with shared logic.
 *
 * Provides serialization/deserialization helpers, config parsing,
 * and version generation following the same patterns as the Python implementation.
 */

import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BlobData, WriteRecord, CheckpointRecord, ParsedConfig } from "./types.js";

// Type for channel versions
type ChannelVersions = Record<string, string | number>;

/**
 * Base class providing shared functionality for Neo4j checkpoint savers.
 * Handles serialization, config parsing, and version management.
 */
export abstract class BaseNeo4jSaver extends BaseCheckpointSaver {
  /**
   * Parse thread_id, checkpoint_ns, and checkpoint_id from config.
   */
  protected parseConfig(config: RunnableConfig): ParsedConfig {
    const configurable = config.configurable ?? {};
    const threadId = configurable.thread_id as string | undefined;

    if (!threadId) {
      throw new Error("thread_id is required in config.configurable");
    }

    return {
      threadId,
      checkpointNs: (configurable.checkpoint_ns as string) ?? "",
      checkpointId: configurable.checkpoint_id as string | undefined,
    };
  }

  /**
   * Generate next version ID using monotonic versioning.
   * Format: '{version:032}.{hash:016}'
   */
  override getNextVersion(current: number | undefined): number {
    if (current === undefined) {
      return 1;
    }
    return current + 1;
  }

  /**
   * Generate a string version for Neo4j storage.
   * Format: '00000000000000000000000000000001.0000000000000000'
   */
  protected getNextVersionString(current: string | null): string {
    if (current === null) {
      return `${"1".padStart(32, "0")}.${"0".padStart(16, "0")}`;
    }

    const [versionStr, hashStr] = current.split(".");
    const nextVersion = parseInt(versionStr, 10) + 1;
    const nextHash = parseInt(hashStr, 10);

    return `${nextVersion.toString().padStart(32, "0")}.${nextHash.toString().padStart(16, "0")}`;
  }

  /**
   * Check if a value can be serialized to simple JSON without data loss.
   */
  protected isSimpleJsonSerializable(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      return true;
    }
    if (Array.isArray(value)) {
      return value.every((item) => this.isSimpleJsonSerializable(item));
    }
    if (typeof value === "object" && value !== null) {
      return Object.entries(value).every(
        ([k, v]) => typeof k === "string" && this.isSimpleJsonSerializable(v)
      );
    }
    return false;
  }

  /**
   * Serialize checkpoint data.
   * Returns [type, serialized string]
   */
  protected async dumpCheckpoint(checkpoint: Checkpoint): Promise<[string, string]> {
    const [type, data] = await this.serde.dumpsTyped(checkpoint);

    if (data instanceof Uint8Array) {
      // Store as JSON with serde wrapper
      return [
        "serde",
        JSON.stringify({
          __serde_type__: type,
          __serde_data__: this.bytesToHex(data),
        }),
      ];
    }

    return ["json", JSON.stringify(checkpoint)];
  }

  /**
   * Deserialize checkpoint data.
   */
  protected async loadCheckpoint(_type: string, data: string): Promise<Checkpoint> {
    const parsed = JSON.parse(data);

    // Check if it's a serde-wrapped value
    if (typeof parsed === "object" && parsed !== null && "__serde_type__" in parsed) {
      const serdeType = parsed.__serde_type__ as string;
      const dataBytes = this.hexToBytes(parsed.__serde_data__ as string);
      return (await this.serde.loadsTyped(serdeType, dataBytes)) as Checkpoint;
    }

    return parsed as Checkpoint;
  }

  /**
   * Serialize checkpoint metadata.
   */
  protected async dumpMetadata(metadata: CheckpointMetadata): Promise<[string, string]> {
    const [serdeType, data] = await this.serde.dumpsTyped(metadata);

    if (data instanceof Uint8Array) {
      return [
        "serde",
        JSON.stringify({
          __serde_type__: serdeType,
          __serde_data__: this.bytesToHex(data),
        }),
      ];
    }

    return ["json", JSON.stringify(metadata)];
  }

  /**
   * Deserialize checkpoint metadata.
   */
  protected async loadMetadata(_type: string, data: string): Promise<CheckpointMetadata> {
    const parsed = JSON.parse(data);

    if (typeof parsed === "object" && parsed !== null && "__serde_type__" in parsed) {
      const serdeType = parsed.__serde_type__ as string;
      const dataBytes = this.hexToBytes(parsed.__serde_data__ as string);
      return (await this.serde.loadsTyped(serdeType, dataBytes)) as CheckpointMetadata;
    }

    return parsed as CheckpointMetadata;
  }

  /**
   * Serialize channel values to blob records for Neo4j storage.
   */
  protected async dumpBlobs(
    channelValues: Record<string, unknown>,
    channelVersions: ChannelVersions
  ): Promise<BlobData[]> {
    const blobs: BlobData[] = [];

    for (const [channel, value] of Object.entries(channelValues)) {
      const version = String(channelVersions[channel] ?? "");

      if (this.isSimpleJsonSerializable(value)) {
        blobs.push({
          channel,
          version,
          type: "json",
          blob: JSON.stringify(value),
        });
      } else {
        // Use serde for complex objects
        const [type, data] = await this.serde.dumpsTyped(value);

        if (data instanceof Uint8Array) {
          blobs.push({
            channel,
            version,
            type: "serde",
            blob: JSON.stringify({
              __serde_type__: type,
              __serde_data__: this.bytesToHex(data),
            }),
          });
        } else {
          blobs.push({
            channel,
            version,
            type: "json",
            blob: JSON.stringify(value),
          });
        }
      }
    }

    return blobs;
  }

  /**
   * Deserialize blob records to channel values.
   */
  protected async loadBlobs(
    blobRecords: Array<{ channel: string; type: string; blob: string }>
  ): Promise<Record<string, unknown>> {
    const channelValues: Record<string, unknown> = {};

    for (const record of blobRecords) {
      const parsed = JSON.parse(record.blob);

      if (
        record.type === "serde" ||
        (typeof parsed === "object" && parsed !== null && "__serde_type__" in parsed)
      ) {
        const serdeType = parsed.__serde_type__ as string;
        const dataBytes = this.hexToBytes(parsed.__serde_data__ as string);
        channelValues[record.channel] = await this.serde.loadsTyped(serdeType, dataBytes);
      } else {
        channelValues[record.channel] = parsed;
      }
    }

    return channelValues;
  }

  /**
   * Serialize pending writes to write records for Neo4j storage.
   */
  protected async dumpWrites(
    writes: PendingWrite[],
    taskId: string,
    taskPath: string = ""
  ): Promise<WriteRecord[]> {
    const writeRecords: WriteRecord[] = [];

    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx];

      if (this.isSimpleJsonSerializable(value)) {
        writeRecords.push({
          taskId,
          taskPath,
          idx,
          channel,
          type: "json",
          blob: JSON.stringify(value),
        });
      } else {
        const [type, data] = await this.serde.dumpsTyped(value);

        if (data instanceof Uint8Array) {
          writeRecords.push({
            taskId,
            taskPath,
            idx,
            channel,
            type: "serde",
            blob: JSON.stringify({
              __serde_type__: type,
              __serde_data__: this.bytesToHex(data),
            }),
          });
        } else {
          writeRecords.push({
            taskId,
            taskPath,
            idx,
            channel,
            type: "json",
            blob: JSON.stringify(value),
          });
        }
      }
    }

    return writeRecords;
  }

  /**
   * Deserialize write records to pending writes.
   * Returns array of [taskId, channel, value]
   */
  protected async loadWrites(
    writeRecords: Array<{ task_id: string; channel: string; type: string; blob: string }>
  ): Promise<Array<[string, string, unknown]>> {
    const pendingWrites: Array<[string, string, unknown]> = [];

    for (const record of writeRecords) {
      const parsed = JSON.parse(record.blob);

      let value: unknown;
      if (
        record.type === "serde" ||
        (typeof parsed === "object" && parsed !== null && "__serde_type__" in parsed)
      ) {
        const serdeType = parsed.__serde_type__ as string;
        const dataBytes = this.hexToBytes(parsed.__serde_data__ as string);
        value = await this.serde.loadsTyped(serdeType, dataBytes);
      } else {
        value = parsed;
      }

      pendingWrites.push([record.task_id, record.channel, value]);
    }

    return pendingWrites;
  }

  /**
   * Create a CheckpointTuple from database records.
   */
  protected async makeCheckpointTuple(
    checkpointRecord: CheckpointRecord,
    _channelValues: Record<string, unknown>,
    pendingWrites: Array<[string, string, unknown]>
  ): Promise<CheckpointTuple> {
    const { thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, metadata } =
      checkpointRecord;

    // Deserialize checkpoint and metadata
    const checkpoint = await this.loadCheckpoint(type, checkpointRecord.checkpoint);
    const deserializedMetadata = await this.loadMetadata(type, metadata);

    // Build config
    const config: RunnableConfig = {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id,
      },
    };

    // Build parent config if exists
    let parentConfig: RunnableConfig | undefined;
    if (parent_checkpoint_id) {
      parentConfig = {
        configurable: {
          thread_id,
          checkpoint_ns,
          checkpoint_id: parent_checkpoint_id,
        },
      };
    }

    // Convert pending writes to the expected format
    const checkpointPendingWrites = pendingWrites.map(
      ([taskId, channel, value]) => [taskId, channel, value] as [string, string, unknown]
    );

    return {
      config,
      checkpoint,
      metadata: deserializedMetadata,
      parentConfig,
      pendingWrites: checkpointPendingWrites,
    };
  }

  /**
   * Convert Uint8Array to hex string.
   */
  protected bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Convert hex string to Uint8Array.
   */
  protected hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }
}
