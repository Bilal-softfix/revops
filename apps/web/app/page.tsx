import { redirect } from 'next/navigation';

/** `/` → the dashboard; the (app) layout sends signed-out visitors to /login. */
export default function HomePage() {
  redirect('/dashboard');
}
