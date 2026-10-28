import { Toaster } from '@/components/ui/toaster'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Outlet, Link } from 'react-router-dom'
import { AuthProvider, RequireAdmin, RequireAuth } from '@/lib/auth'
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
} from '@/components/ui/navigation-menu'
import Index from './pages/Index'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Reset from './pages/Reset'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import Shop from './pages/Shop'
import About from './pages/About'
import Contact from './pages/Contact'

const queryClient = new QueryClient()

const MainNav = () => (
  <NavigationMenu className='mb-2 w-full border-b bg-background'>
    <NavigationMenuList>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link to='/' className='px-4 py-2 font-medium hover:underline'>
            Home
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link to='/about' className='px-4 py-2 font-medium hover:underline'>
            About
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link to='/contact' className='px-4 py-2 font-medium hover:underline'>
            Contact
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link to='/login' className='px-4 py-2 font-medium hover:underline'>
            Login
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
      <NavigationMenuItem>
        <NavigationMenuLink asChild>
          <Link to='/signup' className='px-4 py-2 font-medium hover:underline'>
            Sign up
          </Link>
        </NavigationMenuLink>
      </NavigationMenuItem>
    </NavigationMenuList>
  </NavigationMenu>
)

const RootWithNav = () => (
  <>
    <MainNav />
    <Outlet />
  </>
)

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path='/' element={<RootWithNav />}>
              <Route index element={<Index />} />
              <Route path='about' element={<About />} />
              <Route path='contact' element={<Contact />} />
              <Route path='login' element={<Login />} />
              <Route path='signup' element={<Signup />} />
              <Route path='reset' element={<Reset />} />
              {/* Kept for agent rewrites that need a shop route; not in default nav */}
              <Route path='shop' element={<Shop />} />
              <Route
                path='dashboard'
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              <Route
                path='admin'
                element={
                  <RequireAdmin>
                    <Admin />
                  </RequireAdmin>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
)

export default App
