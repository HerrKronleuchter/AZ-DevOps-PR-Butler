import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class PRButlerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Azure DevOps'});
        page.add(group);

        const orgRow = new Adw.EntryRow({title: 'Organization'});
        settings.bind('azure-org', orgRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(orgRow);

        const patRow = new Adw.PasswordEntryRow({title: 'Personal access token'});
        settings.bind('azure-pat', patRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        group.add(patRow);

        const intervalRow = new Adw.SpinRow({
            title: 'Refresh interval (seconds)',
            adjustment: new Gtk.Adjustment({lower: 30, upper: 3600, step_increment: 30}),
        });
        settings.bind('refresh-interval', intervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(intervalRow);

        window.add(page);
    }
}
