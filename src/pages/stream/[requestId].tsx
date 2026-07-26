import type { MediaRequest } from '@server/entity/MediaRequest';
import axios from 'axios';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';

interface StreamStatus {
  id: number;
  method: string;
  status: {
    ready: boolean;
    progress: number;
    numSeeds: number;
    numLeechs: number;
    dlspeed: number;
    state: string;
    filePath: string | null;
    contentType: string;
  };
}

const StreamPlayerPage = () => {
  const router = useRouter();
  const { requestId } = router.query;
  const [streamStatus, setStreamStatus] = useState<StreamStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const intl = useIntl();

  useEffect(() => {
    if (!requestId) {
      return;
    }

    let cancelled = false;
    let pollInterval: NodeJS.Timeout;

    const pollStatus = async () => {
      try {
        const response = await axios.get<StreamStatus>(
          `/api/v1/stream/${requestId}/status`
        );
        if (cancelled) {
          return;
        }

        const data = response.data;
        setStreamStatus(data);

        if (data.method === 'direct_stream') {
          setReady(true);
          return;
        }

        if (data.status.ready) {
          setReady(true);
          return;
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : 'Failed to get stream status'
          );
        }
      }
    };

    pollStatus();
    pollInterval = setInterval(pollStatus, 2000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
    };
  }, [requestId]);

  if (!requestId) {
    return null;
  }

  const progressPercent = streamStatus
    ? Math.round(streamStatus.status.progress * 100)
    : 0;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 text-white">
      {error && (
        <div className="rounded-lg bg-red-800 p-6 text-center">
          <h2 className="mb-2 text-xl font-bold">Stream Error</h2>
          <p>{error}</p>
          <button
            className="mt-4 rounded bg-indigo-600 px-4 py-2 hover:bg-indigo-700"
            onClick={() => router.back()}
          >
            Go Back
          </button>
        </div>
      )}

      {!error && streamStatus?.method === 'direct_stream' && (
        <div className="text-center">
          <p className="mb-4 text-lg">Redirecting to stream...</p>
        </div>
      )}

      {!error && !ready && streamStatus?.method !== 'direct_stream' && (
        <div className="w-full max-w-md text-center">
          <h2 className="mb-6 text-2xl font-bold">Buffering</h2>
          <div className="mb-4 h-4 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="mb-2 text-lg">{progressPercent}%</p>
          <div className="flex justify-center space-x-6 text-sm text-gray-400">
            <span>
              Seeds: {streamStatus?.status.numSeeds ?? 0}
            </span>
            <span>
              Speed:{' '}
              {streamStatus?.status.dlspeed
                ? `${(streamStatus.status.dlspeed / 1024 / 1024).toFixed(1)} MB/s`
                : '0 MB/s'}
            </span>
            <span>State: {streamStatus?.status.state ?? 'connecting'}</span>
          </div>
        </div>
      )}

      {!error && ready && streamStatus?.method !== 'direct_stream' && (
        <div className="flex h-full w-full items-center justify-center">
          <video
            className="max-h-screen w-full"
            controls
            autoPlay
            src={`/api/v1/stream/${requestId}/video`}
          >
            <p>Your browser does not support HTML5 video.</p>
          </video>
        </div>
      )}
    </div>
  );
};

export default StreamPlayerPage;
