'use client';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

/**
 * App toasts (Sonner), in the indigo theme: a white card with a coloured accent bar and icon per
 * type. Bottom-right on desktop, top on phones (Sonner switches below 600 px). Light only for now.
 */
const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    position="bottom-right"
    mobileOffset={{ top: 12 }}
    gap={10}
    visibleToasts={4}
    duration={4500}
    icons={{
      success: <CircleCheckIcon className="size-[18px]" />,
      info: <InfoIcon className="size-[18px]" />,
      warning: <TriangleAlertIcon className="size-[18px]" />,
      error: <OctagonXIcon className="size-[18px]" />,
      loading: <Loader2Icon className="size-[18px] animate-spin" />,
    }}
    toastOptions={{
      unstyled: false,
      classNames: {
        toast:
          'group/toast !items-start !gap-3 !rounded-xl !border !border-border !bg-card !p-4 !pl-5 !text-card-foreground !shadow-raised before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-full before:bg-primary data-[type=success]:before:bg-success data-[type=error]:before:bg-destructive data-[type=warning]:before:bg-warning data-[type=info]:before:bg-info',
        title: '!text-sm !font-semibold',
        description: '!text-[13px] !text-muted-foreground',
        icon: '!mt-0.5 group-data-[type=success]/toast:text-success group-data-[type=error]/toast:text-destructive group-data-[type=warning]/toast:text-warning-foreground group-data-[type=info]/toast:text-info',
        actionButton: '!rounded-md !bg-primary !text-primary-foreground !font-medium',
        cancelButton: '!rounded-md !bg-muted !text-foreground',
        closeButton: '!border-border !bg-card !text-muted-foreground hover:!text-foreground',
      },
    }}
    {...props}
  />
);

export { Toaster };
