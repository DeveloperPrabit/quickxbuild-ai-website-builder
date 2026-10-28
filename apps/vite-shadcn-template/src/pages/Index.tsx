import { Link } from 'react-router-dom'

/**
 * Neutral starter home — replaced by the in-product agent for each user brief.
 * Do NOT put ecommerce, agency, or demo-brand copy here.
 */
export default function Index() {
  return (
    <div className='flex min-h-[70vh] flex-col items-center justify-center gap-4 p-8'>
      <h1 className='text-center text-3xl font-semibold tracking-tight'>Your app is ready</h1>
      <p className='max-w-lg text-center text-muted-foreground'>
        Describe what to build in chat. This starter screen will be replaced with your product.
      </p>
      <div className='flex flex-wrap justify-center gap-3'>
        <Link className='rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted' to='/about'>
          About
        </Link>
        <Link
          className='rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted'
          to='/contact'
        >
          Contact
        </Link>
      </div>
    </div>
  )
}
