import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map, take } from 'rxjs';

export function roleGuard(requiredRole: string): CanActivateFn {
  return () => {
    const oidcService = inject(OidcSecurityService);
    const router = inject(Router);

    return oidcService.getAccessToken().pipe(
      take(1),
      map(token => {
        if (!token) {
          return router.createUrlTree(['/unauthorized']);
        }
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          const roles: string[] = payload.realm_access?.roles ?? [];
          if (roles.includes(requiredRole)) {
            return true;
          }
        } catch {}
        return router.createUrlTree(['/unauthorized']);
      })
    );
  };
}
