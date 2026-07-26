import { MediaRequestMethod } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import { isAuthenticated } from '@server/middleware/auth';
import torrentStreamService from '@server/lib/torrentstream';
import logger from '@server/logger';
import { Router } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';

const streamRoutes = Router();

streamRoutes.get('/:requestId/status', isAuthenticated(), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: Number(requestId) },
    });

    if (!request) {
      return next({ status: 404, message: 'Request not found' });
    }

    const status = await torrentStreamService.getStreamStatus(Number(requestId));

    return res.status(200).json({
      id: request.id,
      method: request.method,
      status: status,
    });
  } catch (e) {
    return next({ status: 500, message: e instanceof Error ? e.message : 'Stream status error' });
  }
});

streamRoutes.post('/:requestId/stop', isAuthenticated(), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    await torrentStreamService.stopStream(Number(requestId));

    return res.status(200).json({ message: 'Stream stopped' });
  } catch (e) {
    return next({ status: 500, message: e instanceof Error ? e.message : 'Stream stop error' });
  }
});

streamRoutes.get('/:requestId/video', isAuthenticated(), async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const requestRepository = getRepository(MediaRequest);
    const request = await requestRepository.findOne({
      where: { id: Number(requestId) },
    });

    if (!request) {
      return next({ status: 404, message: 'Request not found' });
    }

    if (request.method === MediaRequestMethod.DIRECT_STREAM) {
      const result = await torrentStreamService.handleDirectStream(Number(requestId));
      if (result.streamUrl) {
        return res.redirect(result.streamUrl);
      }
      return next({ status: 404, message: 'Stream URL not found' });
    }

    const active = torrentStreamService.getActiveStream(Number(requestId));

    if (!active || !active.filePath) {
      const status = await torrentStreamService.getStreamStatus(Number(requestId));
      if (!status.filePath) {
        return next({ status: 425, message: 'Stream not ready yet. Still buffering.' });
      }
      return serveVideoFile(res, req, status.filePath, status.contentType, next);
    }

    return serveVideoFile(res, req, active.filePath, active.contentType, next);
  } catch (e) {
    return next({ status: 500, message: e instanceof Error ? e.message : 'Stream video error' });
  }
});

function serveVideoFile(
  res: any,
  req: any,
  filePath: string,
  contentType: string,
  next: any
) {
  if (!existsSync(filePath)) {
    return next({ status: 404, message: 'Video file not found' });
  }

  const stat = statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    if (start >= fileSize) {
      res.status(416);
      res.set({
        'Content-Range': `bytes */${fileSize}`,
      });
      return res.end();
    }

    const stream = createReadStream(filePath, { start, end });
    res.status(206);
    res.set({
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    stream.pipe(res);
  } else {
    res.status(200);
    res.set({
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    createReadStream(filePath).pipe(res);
  }
}

export default streamRoutes;
