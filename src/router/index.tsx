import { createBrowserRouter } from 'react-router-dom'
import AppLayout from '../layouts/AppLayout'
import HomePage from '../pages/HomePage'
import NotFoundPage from '../pages/404'
import Login from '../pages/Login'
import Register from '../pages/Register'
import ForgotPassword from '../pages/ForgotPassword'
import ScanPage from '../pages/ScanPage'
import ScanAddedPage from '../pages/ScanAddedPage'
import ScanFailedPage from '../pages/ScanFailedPage'
import ProfilePage from '../pages/ProfilePage'
import ItemsPage from '../pages/ItemsPage'
import AddItemPage from '../pages/AddItemPage'
import RequireAuth from '../components/RequireAuth'
import ProductDetailPage from '../pages/ProductDetailPage'

export const router = createBrowserRouter([
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      {
        path: '/',
        element: <HomePage />,
      },
      {
        path: '/scan/added',
        element: <ScanAddedPage />,
      },
      {
        path: '/scan/failed',
        element: <ScanFailedPage />,
      },
      {
        path: '/profile',
        element: <ProfilePage />,
      },
      {
        path: '/items',
        element: <ItemsPage />,
      },
      {
        path: '/items/:id',
        element: <ProductDetailPage/>,
      },
      {
        path: '/items/new',
        element: <AddItemPage />,
      },
    ],
  },
  {
    path: '/scan',
    element: (
      <RequireAuth>
        <ScanPage />
      </RequireAuth>
    ),
  },
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/register',
    element: <Register />,
  },
  {
    path: '/forgot-password',
    element: <ForgotPassword />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
 
])
