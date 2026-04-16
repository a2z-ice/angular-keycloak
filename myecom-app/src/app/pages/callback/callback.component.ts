import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';

@Component({
  selector: 'app-callback',
  standalone: true,
  template: `<div class="page"><p>Authenticating...</p></div>`,
})
export class CallbackComponent implements OnInit {
  private oidcService = inject(OidcSecurityService);
  private router = inject(Router);

  ngOnInit() {
    this.oidcService.checkAuth().subscribe(({ isAuthenticated }) => {
      if (isAuthenticated) {
        this.router.navigate(['/dashboard']);
      } else {
        this.router.navigate(['/']);
      }
    });
  }
}
