import Button from '@app/components/Common/Button';
import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import type { FilterOptions } from '@app/components/Discover/constants';
import {
  countActiveFilters,
  prepareFilterValues,
} from '@app/components/Discover/constants';
import FilterSlideover from '@app/components/Discover/FilterSlideover';
import useDiscover from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, FunnelIcon } from '@heroicons/react/24/solid';
import type { SortOptions as TMDBSortOptions } from '@server/api/themoviedb';
import type { Language } from '@server/lib/settings';
import type { MovieResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Discover.DiscoverMovies', {
  discovermovies: 'Movies',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
  sortPopularityAsc: 'Popularity Ascending',
  sortPopularityDesc: 'Popularity Descending',
  sortReleaseDateAsc: 'Release Date Ascending',
  sortReleaseDateDesc: 'Release Date Descending',
  sortTmdbRatingAsc: 'TMDB Rating Ascending',
  sortTmdbRatingDesc: 'TMDB Rating Descending',
  sortTitleAsc: 'Title (A-Z) Ascending',
  sortTitleDesc: 'Title (Z-A) Descending',
});

const SortOptions: Record<string, TMDBSortOptions> = {
  PopularityAsc: 'popularity.asc',
  PopularityDesc: 'popularity.desc',
  ReleaseDateAsc: 'release_date.asc',
  ReleaseDateDesc: 'release_date.desc',
  TmdbRatingAsc: 'vote_average.asc',
  TmdbRatingDesc: 'vote_average.desc',
  TitleAsc: 'original_title.asc',
  TitleDesc: 'original_title.desc',
} as const;

const DiscoverMovies = () => {
  const intl = useIntl();
  const router = useRouter();
  const updateQueryParams = useUpdateQueryParams({});
  const { currentSettings } = useSettings();

  const preparedFilters = prepareFilterValues(router.query);

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult, unknown, FilterOptions>(
    '/api/v1/discover/movies',
    preparedFilters
  );

  const discoverLanguageCodes = useMemo(
    () =>
      currentSettings.discoverLanguages
        ? currentSettings.discoverLanguages.split('|')
        : [],
    [currentSettings.discoverLanguages]
  );

  const selectedLanguage = router.query.originalLanguage as string | undefined;

  const { data: languages } = useSWR<Language[]>('/api/v1/languages');

  const languageMap = useMemo(() => {
    const map: Record<string, string> = {};
    languages?.forEach((lang) => {
      map[lang.iso_639_1] =
        intl.formatDisplayName(lang.iso_639_1, {
          type: 'language',
          fallback: 'none',
        }) ?? lang.english_name;
    });
    return map;
  }, [intl, languages]);

  useEffect(() => {
    if (
      discoverLanguageCodes.length > 0 &&
      !router.query.originalLanguage
    ) {
      const params = new URLSearchParams(window.location.search);
      params.set('originalLanguage', discoverLanguageCodes[0]);
      router.replace(`/discover/movies?${params.toString()}`, undefined, {
        shallow: true,
      });
    }
  }, [discoverLanguageCodes, router.query.originalLanguage]);

  const updateLanguage = (value: string | undefined) => {
    const params = new URLSearchParams(window.location.search);
    if (!value || value === 'all') {
      params.delete('originalLanguage');
    } else {
      params.set('originalLanguage', value);
    }
    const qs = params.toString();
    router.push(`/discover/movies${qs ? `?${qs}` : ''}`);
  };

  const [showFilters, setShowFilters] = useState(false);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const title = intl.formatMessage(messages.discovermovies);

  return (
    <>
      <PageTitle title={title} />
      <div className="mb-4 flex flex-col justify-between lg:flex-row lg:items-end">
        <Header>{title}</Header>
        <div className="mt-2 flex flex-grow flex-col sm:flex-row lg:flex-grow-0">
          <div className="mb-2 flex flex-grow sm:mb-0 sm:mr-2 lg:flex-grow-0">
            <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
              <BarsArrowDownIcon className="h-6 w-6" />
            </span>
            <select
              id="sortBy"
              name="sortBy"
              className="rounded-r-only"
              value={preparedFilters.sortBy || SortOptions.ReleaseDateDesc}
              onChange={(e) => updateQueryParams('sortBy', e.target.value)}
            >
              <option value={SortOptions.PopularityDesc}>
                {intl.formatMessage(messages.sortPopularityDesc)}
              </option>
              <option value={SortOptions.PopularityAsc}>
                {intl.formatMessage(messages.sortPopularityAsc)}
              </option>
              <option value={SortOptions.ReleaseDateDesc}>
                {intl.formatMessage(messages.sortReleaseDateDesc)}
              </option>
              <option value={SortOptions.ReleaseDateAsc}>
                {intl.formatMessage(messages.sortReleaseDateAsc)}
              </option>
              <option value={SortOptions.TmdbRatingDesc}>
                {intl.formatMessage(messages.sortTmdbRatingDesc)}
              </option>
              <option value={SortOptions.TmdbRatingAsc}>
                {intl.formatMessage(messages.sortTmdbRatingAsc)}
              </option>
              <option value={SortOptions.TitleAsc}>
                {intl.formatMessage(messages.sortTitleAsc)}
              </option>
              <option value={SortOptions.TitleDesc}>
                {intl.formatMessage(messages.sortTitleDesc)}
              </option>
            </select>
          </div>
          <FilterSlideover
            type="movie"
            currentFilters={preparedFilters}
            onClose={() => setShowFilters(false)}
            show={showFilters}
          />
          <div className="mb-2 flex flex-grow sm:mb-0 lg:flex-grow-0">
            <Button onClick={() => setShowFilters(true)} className="w-full">
              <FunnelIcon />
              <span>
                {intl.formatMessage(messages.activefilters, {
                  count: countActiveFilters(preparedFilters),
                })}
              </span>
            </Button>
          </div>
        </div>
      </div>
      <div className="mb-6 flex flex-col space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-400">Language:</span>
          <button
            onClick={() => updateLanguage(undefined)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              !selectedLanguage
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            All
          </button>
          {discoverLanguageCodes.map((code) => (
            <button
              key={code}
              onClick={() =>
                updateLanguage(
                  selectedLanguage === code ? undefined : code
                )
              }
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                selectedLanguage === code
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {languageMap[code] ?? code.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <ListView
        items={titles}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
      />
    </>
  );
};

export default DiscoverMovies;
