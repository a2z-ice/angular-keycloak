import { Injectable, inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { map, switchMap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private oidcService = inject(OidcSecurityService);

  isAuthenticated$ = this.oidcService.isAuthenticated$.pipe(
    map(({ isAuthenticated }) => isAuthenticated)
  );

  userData$ = this.oidcService.userData$.pipe(
    map(({ userData }) => userData)
  );

  /** Decode access token to get realm_access.roles */
  roles$ = this.oidcService.getAccessToken().pipe(
    map(token => {
      if (!token) return [];
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return (payload.realm_access?.roles as string[]) ?? [];
      } catch {
        return [];
      }
    })
  );

  hasRole$(role: string) {
    return this.roles$.pipe(map(roles => roles.includes(role)));
  }

  login() {
    this.oidcService.authorize();
  }

  logout() {
    this.oidcService.logoff().subscribe();
  }

  getAccessToken() {
    return this.oidcService.getAccessToken();
  }
}
