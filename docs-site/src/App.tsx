import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ApiIndexPage, ApiTagPage } from './pages/ApiPage'
import { GuidePage } from './pages/GuidePage'

const GUIDE_SLUGS = [
  'why',
  'quickstart',
  'architecture',
  'concepts',
  'auth',
  'instances',
  'messages',
  'media',
  'chats',
  'contacts',
  'presence',
  'webhooks',
  'realtime',
  'voip',
  'groups',
  'errors',
  'faq',
] as const

function GuideSlugRoute() {
  const { slug = '' } = useParams()
  return <GuidePage slug={slug} />
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<GuidePage slug="intro" />} />
        {GUIDE_SLUGS.map((slug) => (
          <Route key={slug} path={`/${slug}`} element={<GuidePage slug={slug} />} />
        ))}
        <Route path="/api" element={<ApiIndexPage />} />
        <Route path="/api/:tag" element={<ApiTagPage />} />
        {/* catch legacy /guide/* when base is already /guide/ */}
        <Route path="/guide" element={<Navigate to="/" replace />} />
        <Route path="/guide/:slug" element={<GuideSlugRoute />} />
        <Route path="*" element={<GuidePage slug="missing" />} />
      </Routes>
    </Layout>
  )
}
