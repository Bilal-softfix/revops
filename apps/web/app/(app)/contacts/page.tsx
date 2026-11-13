import type { Metadata } from 'next';
import { ContactsView } from '@/features/contacts/contacts-view';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return <ContactsView />;
}
