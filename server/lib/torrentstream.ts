import QbittorrentAPI from '@server/api/qbittorrent';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { createReadStream, existsSync, statSync } from 'fs';
import { readFile, readdir } from 'fs/promises';
import path from 'path';

interface ActiveStream {
  requestId: number;
  torrentHash: string;
  filePath: string | null;
  fileSize: number;
  contentType: string;
  startedAt: Date;
}

class TorrentStreamService {
  private activeStreams: Map<number, ActiveStream> = new Map();
  private qbClient: QbittorrentAPI | null = null;

  private getQbClient(): QbittorrentAPI {
    if (!this.qbClient) {
      const settings = getSettings();
      this.qbClient = new QbittorrentAPI({
        hostname: settings.qbittorrent.hostname,
        port: settings.qbittorrent.port,
        username: settings.qbittorrent.username,
        password: settings.qbittorrent.password,
      });
    }
    return this.qbClient;
  }

  async startTorrentStream(
    requestId: number,
    magnet: string,
    mediaTitle: string
  ): Promise<{ torrentHash: string }> {
    const settings = getSettings();
    const qb = this.getQbClient();

    const savePath = path.join('/downloads/streams', `request-${requestId}`);

    const torrentHash = await qb.addTorrent(magnet, {
      sequentialDownload: true,
      forceStart: true,
      savePath,
      category: 'seerr-stream',
    });

    this.activeStreams.set(requestId, {
      requestId,
      torrentHash,
      filePath: null,
      fileSize: 0,
      contentType: 'video/mp4',
      startedAt: new Date(),
    });

    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId },
    });
    if (request) {
      request.qbTorrentHash = torrentHash;
      await requestRepository.save(request);
    }

    const info = await qb.getTorrentInfo(torrentHash);

    if (info && !info.seqDl) {
      await qb.toggleSequentialDownload(torrentHash);
    }
    if (info && !info.forceStart) {
      await qb.setForceStart(torrentHash, true);
    }

    logger.info(
      `Torrent stream started: request=${requestId} hash=${torrentHash} title="${mediaTitle}"`
    );

    return { torrentHash };
  }

  async getStreamStatus(
    requestId: number
  ): Promise<{
    ready: boolean;
    progress: number;
    numSeeds: number;
    numLeechs: number;
    dlspeed: number;
    state: string;
    filePath: string | null;
    contentType: string;
  }> {
    const settings = getSettings();
    const qb = this.getQbClient();

    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId },
    });

    if (!request || !request.qbTorrentHash) {
      return {
        ready: false,
        progress: 0,
        numSeeds: 0,
        numLeechs: 0,
        dlspeed: 0,
        state: 'not_started',
        filePath: null,
        contentType: 'video/mp4',
      };
    }

    const info = await qb.getTorrentInfo(request.qbTorrentHash);

    if (!info) {
      return {
        ready: false,
        progress: 0,
        numSeeds: 0,
        numLeechs: 0,
        dlspeed: 0,
        state: 'not_found',
        filePath: null,
        contentType: 'video/mp4',
      };
    }

    const ready = qb.isStreamReady(
      info,
      settings.qbittorrent.streamBufferPercent,
      settings.qbittorrent.minSeeders
    );

    let filePath = this.activeStreams.get(requestId)?.filePath || null;
    let contentType =
      this.activeStreams.get(requestId)?.contentType || 'video/mp4';

    if (ready && !filePath) {
      const resolved = await this.resolveFilePath(
        request.qbTorrentHash,
        info.savePath
      );
      if (resolved) {
        filePath = resolved.filePath;
        contentType = resolved.contentType;

        const stream = this.activeStreams.get(requestId);
        if (stream) {
          stream.filePath = filePath;
          stream.contentType = contentType;
          stream.fileSize = resolved.fileSize;
        } else {
          this.activeStreams.set(requestId, {
            requestId,
            torrentHash: request.qbTorrentHash,
            filePath,
            fileSize: resolved.fileSize,
            contentType,
            startedAt: new Date(),
          });
        }
      }
    }

    return {
      ready,
      progress: info.progress,
      numSeeds: info.numSeeds,
      numLeechs: info.numLeechs,
      dlspeed: info.dlspeed,
      state: info.state,
      filePath,
      contentType,
    };
  }

  private async resolveFilePath(
    torrentHash: string,
    savePath: string
  ): Promise<{ filePath: string; fileSize: number; contentType: string } | null> {
    const qb = this.getQbClient();

    try {
      const files = await qb.getTorrentFiles(torrentHash);

      const videoFiles = files
        .filter((f) => {
          const ext = path.extname(f.name).toLowerCase();
          return ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v'].includes(ext);
        })
        .sort((a, b) => b.size - a.size);

      if (videoFiles.length === 0) {
        logger.warn(`No video files found in torrent ${torrentHash}`);
        return null;
      }

      const largest = videoFiles[0];
      const fullPath = path.join(savePath, largest.name);

      if (!existsSync(fullPath)) {
        return null;
      }

      const ext = path.extname(largest.name).toLowerCase();
      const contentTypeMap: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.m4v': 'video/mp4',
      };

      return {
        filePath: fullPath,
        fileSize: largest.size,
        contentType: contentTypeMap[ext] || 'video/mp4',
      };
    } catch (e) {
      logger.error(`Failed to resolve file path for torrent ${torrentHash}`, {
        errorMessage: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  async stopStream(requestId: number, deleteFiles = true): Promise<void> {
    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId },
    });

    if (request?.qbTorrentHash) {
      try {
        const qb = this.getQbClient();
        await qb.removeTorrent(request.qbTorrentHash, deleteFiles);
      } catch (e) {
        logger.warn(`Failed to remove torrent for request ${requestId}`, {
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }

      request.qbTorrentHash = '';
      await requestRepository.save(request);
    }

    this.activeStreams.delete(requestId);
  }

  async cleanExpiredStreams(): Promise<number> {
    const settings = getSettings();
    const retentionMs = settings.qbittorrent.streamRetentionDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - retentionMs);
    let cleaned = 0;

    const requestRepository = getRepository(MediaRequest);
    const expiredRequests = await requestRepository
      .createQueryBuilder('request')
      .where('request.qbTorrentHash IS NOT NULL')
      .andWhere('request.qbTorrentHash != :empty', { empty: '' })
      .andWhere('request.updatedAt < :cutoff', { cutoff })
      .getMany();

    for (const request of expiredRequests) {
      if (request.qbTorrentHash) {
        try {
          const qb = this.getQbClient();
          await qb.removeTorrent(request.qbTorrentHash, true);
        } catch (e) {
          logger.warn(
            `Failed to clean expired torrent for request ${request.id}`,
            {
              errorMessage: e instanceof Error ? e.message : String(e),
            }
          );
        }

        request.qbTorrentHash = '';
        await requestRepository.save(request);
        this.activeStreams.delete(request.id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired torrent stream(s)`);
    }

    return cleaned;
  }

  async handleDirectStream(
    requestId: number
  ): Promise<{ streamUrl: string | null }> {
    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: requestId },
      relations: ['media'],
    });

    if (!request || !request.streamUrl) {
      return { streamUrl: null };
    }

    request.streamWatched = true;
    await requestRepository.save(request);

    return { streamUrl: request.streamUrl };
  }

  getActiveStream(
    requestId: number
  ): ActiveStream | undefined {
    return this.activeStreams.get(requestId);
  }
}

const torrentStreamService = new TorrentStreamService();
export default torrentStreamService;
