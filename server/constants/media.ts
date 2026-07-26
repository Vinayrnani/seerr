export enum MediaRequestStatus {
  PENDING = 1,
  APPROVED,
  DECLINED,
  FAILED,
  COMPLETED,
}

export enum MediaRequestMethod {
  TORRENT = 'torrent',
  TORRENT_STREAM = 'torrent_stream',
  DIRECT_STREAM = 'direct_stream',
}

export enum MediaType {
  MOVIE = 'movie',
  TV = 'tv',
}

export enum MediaStatus {
  UNKNOWN = 1,
  PENDING,
  PROCESSING,
  PARTIALLY_AVAILABLE,
  AVAILABLE,
  BLOCKLISTED,
  DELETED,
}
