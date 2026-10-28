import { useEffect } from 'react';

export default function NotFoundPage() {
  useEffect(() => {
    document.title = 'BestBefore | 404 - Page Not Found';
  }, []);

  return <h1>404 - Page Not Found</h1>;
}