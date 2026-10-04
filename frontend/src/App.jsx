import React, { Suspense, lazy, useEffect } from 'react';
import { useRoute } from './router';
import Header, { rememberRoute } from './components/shell/Header';
import ErrorBoundary from './components/shell/ErrorBoundary';
import useRouteFocus from './components/shell/useRouteFocus';
import SplitHome from './components/jobs/SplitHome';
import JobView from './components/jobs/JobView';

// Library and Arrange pull in their own heavy code (wavesurfer, the
// arrangement engine) that the Split home never needs: separate chunks.
const LibraryScreen = lazy(() => import('./components/library/LibraryScreen'));
const ArrangeScreen = lazy(() => import('./arrange/ui/ArrangeScreen'));

const BASE_TITLE = 'Audio Splitter';
const SECTION_TITLES = { split: 'Split', library: 'Library', arrange: 'Arrange' };

function Screen({ route }) {
  if (route.section === 'library') return <LibraryScreen />;
  if (route.section === 'arrange') return <ArrangeScreen />;
  const [kind, id] = route.segments;
  if (kind === 'job' && id) return <JobView key={id} taskId={id} />;
  return <SplitHome />;
}

function Loading() {
  return <p className="m-0 py-4 text-caption text-muted">Loading...</p>;
}

function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}

export default function App() {
  const route = useRoute();
  const isJobRoute = route.section === 'split' && route.segments[0] === 'job';

  useEffect(() => rememberRoute(route), [route]);
  useRouteFocus(route.path);

  // The job view titles itself with its progress; everything else is named
  // after its section.
  useEffect(() => {
    if (!isJobRoute) document.title = `${SECTION_TITLES[route.section]} — ${BASE_TITLE}`;
  }, [route.section, isJobRoute]);

  // A file dropped anywhere nothing handles it must never make the browser
  // open it in place of the app (that loses the page). Screens that accept
  // drops handle — and preventDefault — the event first.
  useEffect(() => {
    const onDragOver = (e) => {
      if (!isFileDrag(e) || e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'none';
    };
    const onDrop = (e) => {
      if (isFileDrag(e) && !e.defaultPrevented) e.preventDefault();
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <button
        type="button"
        className="link sr-only text-caption focus:not-sr-only focus:fixed focus:left-4 focus:top-14 focus:z-50 focus:bg-paper"
        onClick={() => document.getElementById('main')?.focus()}
      >
        Skip to content
      </button>
      <Header route={route} />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1920px] px-4 outline-none sm:px-6 lg:px-8">
        <ErrorBoundary resetKey={route.path}>
          <Suspense fallback={<Loading />}>
            <Screen route={route} />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
