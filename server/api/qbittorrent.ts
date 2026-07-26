import logger from '@server/logger';

export interface QbittorrentTorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number;
  state: string;
  numSeeds: number;
  numLeechs: number;
  dlspeed: number;
  upspeed: number;
  seqDl: boolean;
  forceStart: boolean;
  savePath: string;
  category: string;
}

export interface QbittorrentFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
  isSeed: boolean;
}

export interface QbittorrentConfig {
  hostname: string;
  port: number;
  username: string;
  password: string;
}

export class QbittorrentAPI {
  private config: QbittorrentConfig;
  private baseUrl: string;
  private cookie: string | null = null;

  constructor(config: QbittorrentConfig) {
    this.config = config;
    this.baseUrl = `http://${config.hostname}:${config.port}`;
  }

  private get authUrl(): string {
    return `${this.baseUrl}/api/v2/auth/login`;
  }

  private get torrentsInfoUrl(): string {
    return `${this.baseUrl}/api/v2/torrents/info`;
  }

  private get torrentsAddUrl(): string {
    return `${this.baseUrl}/api/v2/torrents/add`;
  }

  private get torrentsDeleteUrl(): string {
    return `${this.baseUrl}/api/v2/torrents/delete`;
  }

  private get torrentsFilesUrl(): string {
    return `${this.baseUrl}/api/v2/torrents/files`;
  }

  private get torrentsSetForceStartUrl(): string {
    return `${this.baseUrl}/api/v2/torrents/setForceStart`;
  }

  private get torrentsToggleSeqUrl(): string {
    return `${this.baseUrl}/api/v2/torrents/toggleSequentialDownload`;
  }

  async login(): Promise<void> {
    const response = await fetch(this.authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
      }),
    });

    const cookie = response.headers.get('set-cookie');
    if (cookie) {
      this.cookie = cookie.split(';')[0];
    }

    if (!this.cookie || !response.ok) {
      throw new Error('Failed to authenticate with qBittorrent');
    }

    logger.info('Authenticated with qBittorrent');
  }

  private async request(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.cookie) {
      await this.login();
    }

    const headers = {
      ...options.headers,
      Cookie: this.cookie || '',
    };

    const response = await fetch(url, { ...options, headers });

    // If unauthorized, try re-authenticating once
    if (response.status === 403) {
      logger.debug('qBittorrent session expired, re-authenticating');
      await this.login();
      return fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          Cookie: this.cookie || '',
        },
      });
    }

    return response;
  }

  async addTorrent(
    magnet: string,
    options?: {
      sequentialDownload?: boolean;
      forceStart?: boolean;
      savePath?: string;
      category?: string;
    }
  ): Promise<string> {
    const body = new URLSearchParams();
    body.append('urls', magnet);

    if (options?.sequentialDownload) {
      body.append('sequentialDownload', 'true');
    }
    if (options?.forceStart) {
      body.append('forceStart', 'true');
    }
    if (options?.savePath) {
      body.append('savepath', options.savePath);
    }
    if (options?.category) {
      body.append('category', options.category);
    }

    const response = await this.request(this.torrentsAddUrl, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to add torrent: ${text}`);
    }

    // Wait a moment for qBittorrent to process, then find the hash
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const torrents = await this.getTorrents();
    const added = torrents.find((t) => magnet.includes(t.hash) || t.name);

    if (added) {
      logger.info(`Torrent added: ${added.name} (${added.hash})`);
      return added.hash;
    }

    // Fallback: return last added torrent's hash
    return torrents[0]?.hash || '';
  }

  async getTorrents(filter?: {
    category?: string;
    sort?: string;
    reverse?: boolean;
    limit?: number;
  }): Promise<QbittorrentTorrentInfo[]> {
    const params = new URLSearchParams();
    if (filter?.category) params.append('category', filter.category);
    if (filter?.sort) params.append('sort', filter.sort);
    if (filter?.reverse) params.append('reverse', filter.reverse ? 'true' : 'false');
    if (filter?.limit) params.append('limit', String(filter.limit));

    const url = `${this.torrentsInfoUrl}?${params.toString()}`;
    const response = await this.request(url);

    if (!response.ok) {
      throw new Error(`Failed to get torrents: ${response.statusText}`);
    }

    const data = await response.json();
    return (data as any[]).map((t: any) => ({
      hash: t.hash,
      name: t.name,
      size: t.size,
      progress: t.progress,
      state: t.state,
      numSeeds: t.num_seeds,
      numLeechs: t.num_leechs,
      dlspeed: t.dlspeed,
      upspeed: t.upspeed,
      seqDl: t.seq_dl,
      forceStart: t.force_start,
      savePath: t.save_path,
      category: t.category,
    }));
  }

  async getTorrentInfo(hash: string): Promise<QbittorrentTorrentInfo | null> {
    const torrents = await this.getTorrents();
    return torrents.find((t) => t.hash === hash) || null;
  }

  async getTorrentFiles(hash: string): Promise<QbittorrentFile[]> {
    const url = `${this.torrentsFilesUrl}?hash=${hash}`;
    const response = await this.request(url);

    if (!response.ok) {
      throw new Error(`Failed to get torrent files: ${response.statusText}`);
    }

    const data = await response.json();
    return (data as any[]).map((f: any) => ({
      index: f.index,
      name: f.name,
      size: f.size,
      progress: f.progress,
      priority: f.priority,
      isSeed: f.priority === 0,
    }));
  }

  async removeTorrent(hash: string, deleteFiles = true): Promise<void> {
    const body = new URLSearchParams();
    body.append('hashes', hash);
    body.append('deleteFiles', deleteFiles ? 'true' : 'false');

    const response = await this.request(this.torrentsDeleteUrl, {
      method: 'POST',
      body,
    });

    if (!response.ok) {
      throw new Error(`Failed to remove torrent: ${response.statusText}`);
    }

    logger.info(`Torrent removed: ${hash}`);
  }

  async setForceStart(hash: string, enabled: boolean): Promise<void> {
    const body = new URLSearchParams();
    body.append('hashes', hash);
    body.append('enable', enabled ? 'true' : 'false');

    await this.request(this.torrentsSetForceStartUrl, {
      method: 'POST',
      body,
    });
  }

  async toggleSequentialDownload(hash: string): Promise<void> {
    const body = new URLSearchParams();
    body.append('hashes', hash);

    await this.request(this.torrentsToggleSeqUrl, {
      method: 'POST',
      body,
    });
  }

  isStreamReady(
    info: QbittorrentTorrentInfo,
    bufferPercent: number,
    minSeeders: number
  ): boolean {
    return (
      info.progress >= bufferPercent / 100 &&
      info.numSeeds >= minSeeders &&
      info.state === 'downloading'
    );
  }
}

export default QbittorrentAPI;
