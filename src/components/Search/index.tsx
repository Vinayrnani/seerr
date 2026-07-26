import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import LanguageSelector from '@app/components/LanguageSelector';
import useDiscover from '@app/hooks/useDiscover';
import useSettings from '@app/hooks/useSettings';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import type { Language } from '@server/lib/settings';
import type {
  MovieResult,
  PersonResult,
  TvResult,
} from '@server/models/Search';
import { useRouter } from 'next/router';
import { useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Search', {
  search: 'Search',
  searchresults: 'Search Results',
});

const Search = () => {
  const intl = useIntl();
  const router = useRouter();
  const { currentSettings } = useSettings();

  const discoverLanguageCodes = useMemo(
    () =>
      currentSettings.discoverLanguages
        ? currentSettings.discoverLanguages.split('|')
        : [],
    [currentSettings.discoverLanguages]
  );

  const selectedLanguage = router.query.originalLanguage as
    | string
    | undefined;

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
      router.replace(`/search?${params.toString()}`, undefined, {
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
    router.push(qs ? `/search?${qs}` : '/search');
  };

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
  } = useDiscover<MovieResult | TvResult | PersonResult>(
    `/api/v1/search`,
    {
      query: router.query.query,
      ...(selectedLanguage ? { originalLanguage: selectedLanguage } : {}),
    },
    { hideAvailable: false, hideBlocklisted: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.search)} />
      <div className="mb-5 mt-1">
        <Header>{intl.formatMessage(messages.searchresults)}</Header>
      </div>
      <div className="mb-6 flex flex-col space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-400">
            Language:
          </span>
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
        <div className="max-w-md">
          <LanguageSelector
            value={selectedLanguage}
            setFieldValue={(_key, value) => updateLanguage(value)}
          />
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

export default Search;
