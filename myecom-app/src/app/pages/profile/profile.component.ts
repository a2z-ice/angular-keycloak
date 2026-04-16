import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [AsyncPipe],
  template: `
    <div class="page">
      <h1>Profile</h1>
      @if (userData$ | async; as user) {
        <div class="card">
          <p><strong>Username:</strong> {{ user.preferred_username }}</p>
          <p><strong>Email:</strong> {{ user.email }}</p>
          <p><strong>Full Name:</strong> {{ user.name }}</p>
          <p><strong>Roles:</strong> {{ user.realm_access?.roles?.join(', ') }}</p>
        </div>
      }
    </div>
  `,
})
export class ProfileComponent {
  private authService = inject(AuthService);
  userData$ = this.authService.userData$;
}
