import { Component } from '@angular/core';

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <div class="page">
      <h1>Settings</h1>
      <div class="card">
        <h3>Application Settings</h3>
        <div class="setting-item">
          <label>Site Name</label>
          <input type="text" value="MyEcom" readonly />
        </div>
        <div class="setting-item">
          <label>Maintenance Mode</label>
          <input type="checkbox" />
        </div>
      </div>
    </div>
  `,
})
export class SettingsComponent {}
