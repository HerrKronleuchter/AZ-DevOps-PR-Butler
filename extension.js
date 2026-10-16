import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const API_VERSION = '7.1';
const AZURE_ORIGIN = 'https://dev.azure.com';

export default class PRButlerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._session = new Soup.Session();
        this._prs = [];
        this._refreshing = false;

        this._indicator = new PanelMenu.Button(0.0, 'PR Butler');
        this._box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({
            icon_name: 'view-list-symbolic',
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({text: '…'});
        this._box.add_child(this._icon);
        this._box.add_child(this._label);
        this._indicator.add_child(this._box);

        this._indicator.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen)
                this._refresh();
        });

        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'refresh-interval')
                this._startTimer();
            this._refresh();
        });

        Main.panel.addToStatusArea('pr-butler', this._indicator);

        this._refresh();
        this._startTimer();
    }

    disable() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._session = null;
        this._settings = null;
        this._prs = [];
    }

    _startTimer() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        const interval = this._settings.get_int('refresh-interval') || 300;
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _escapePathSegment(segment) {
        const text = String(segment);
        if (!text.trim())
            throw new Error('Azure DevOps path segment must not be empty');
        if (/[\/\u0000-\u001f\u007f]/.test(text))
            throw new Error(`Invalid Azure DevOps path segment: ${text}`);

        return encodeURIComponent(text);
    }

    _buildAzureUrl(pathSegments, queryParams = {}) {
        const url = new URL(AZURE_ORIGIN);
        url.pathname = `/${pathSegments.map(segment => this._escapePathSegment(segment)).join('/')}`;

        for (const [key, value] of Object.entries(queryParams)) {
            if (value !== undefined && value !== null)
                url.searchParams.set(key, String(value));
        }

        return url.toString();
    }

    _assertAzureUrl(url) {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'dev.azure.com')
            throw new Error(`Blocked non-Azure URL: ${url}`);
    }

    _sendJson(url, pat) {
        this._assertAzureUrl(url);

        return new Promise((resolve, reject) => {
            const message = Soup.Message.new('GET', url);
            if (pat)
                message.get_request_headers().append('Authorization', `Basic ${GLib.base64_encode(`:${pat}`)}`);

            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const status = message.get_status();
                    if (status < 200 || status >= 300) {
                        reject(new Error(`HTTP ${status} for ${url}`));
                        return;
                    }
                    const text = new TextDecoder('utf-8').decode(bytes.get_data());
                    resolve(JSON.parse(text));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    async _fetchPullRequests() {
        const org = this._settings.get_string('azure-org').trim();
        const pat = this._settings.get_string('azure-pat');

        if (!org || !pat)
            throw new Error('Azure DevOps organization or PAT not configured');

        const connection = await this._sendJson(
            this._buildAzureUrl(
                [org, '_apis', 'connectionData'],
                {
                    connectOptions: 1,
                    lastChangeId: -1,
                    lastChangeId64: -1,
                    'api-version': '7.1-preview.1',
                }
            ),
            pat
        );
        const currentUserId = connection.authenticatedUser?.id;
        if (!currentUserId)
            throw new Error('Could not determine the authenticated Azure DevOps user');

        const projects = (await this._sendJson(
            this._buildAzureUrl([org, '_apis', 'projects'], {'api-version': API_VERSION}),
            pat
        )).value ?? [];

        const prs = [];

        await Promise.all(projects.map(async project => {
            const projectName = project.name ?? '';
            const repos = (await this._sendJson(
                this._buildAzureUrl([org, projectName, '_apis', 'git', 'repositories'], {'api-version': API_VERSION}),
                pat
            )).value ?? [];

            await Promise.all(repos.map(async repo => {
                try {
                    const repoPrs = (await this._sendJson(
                        this._buildAzureUrl(
                            [org, projectName, '_apis', 'git', 'repositories', repo.id, 'pullrequests'],
                            {'searchCriteria.status': 'active', 'api-version': API_VERSION}
                        ),
                        pat
                    )).value ?? [];

                    for (const pr of repoPrs) {
                        const isCreatedByUser = pr.createdBy?.id === currentUserId;
                        const isAssignedToUser = pr.reviewers?.some(reviewer => reviewer.id === currentUserId);
                        if (isCreatedByUser || isAssignedToUser) {
                            prs.push({
                                project: project.name,
                                repo: repo.name,
                                id: pr.pullRequestId,
                                title: pr.title,
                                author: pr.createdBy?.displayName ?? 'Unknown',
                                isAuthor: isCreatedByUser,
                                isReviewer: isAssignedToUser,
                                reviewers: pr.reviewers ?? [],
                                url: this._buildAzureUrl(
                                    [org, projectName, '_git', repo.name, 'pullrequest', pr.pullRequestId]
                                ),
                            });
                        }
                    }
                } catch (e) {
                    logError(e, `PR Butler: failed to fetch PRs for ${project.name}/${repo.name}`);
                }
            }));
        }));

        return prs;
    }

    async _refresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;

        try {
            this._prs = await this._fetchPullRequests();
            this._populateMenu();
        } catch (e) {
            logError(e, 'PR Butler: refresh failed');
            this._populateMenu(e.message);
        } finally {
            this._refreshing = false;
        }
    }

    _populateMenu(errorMessage) {
        this._indicator.menu.removeAll();
        this._label.text = errorMessage ? '!' : `${this._prs.length}`;

        if (errorMessage) {
            this._indicator.menu.addMenuItem(new PopupMenu.PopupMenuItem(`Error: ${errorMessage}`, {reactive: false}));
        } else {
            this._addPullRequestSection('As reviewer', this._prs.filter(pr => pr.isReviewer));
            this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._addPullRequestSection('Created by me', this._prs.filter(pr => pr.isAuthor));
        }

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        refreshItem.connect('activate', () => this._refresh());
        this._indicator.menu.addMenuItem(refreshItem);
    }

    _addPullRequestSection(title, prs) {
        this._indicator.menu.addMenuItem(
            new PopupMenu.PopupMenuItem(`${title} (${prs.length})`, {reactive: false})
        );

        if (prs.length === 0) {
            this._indicator.menu.addMenuItem(
                new PopupMenu.PopupMenuItem('No active pull requests', {reactive: false})
            );
            return;
        }

        for (const pr of prs) {
            const item = new PopupMenu.PopupMenuItem(
                `#${pr.id} ${pr.project}/${pr.repo} — ${pr.title}`
            );
            item.connect('activate', () => {
                this._assertAzureUrl(pr.url);
                Gio.AppInfo.launch_default_for_uri(pr.url, null);
            });
            this._indicator.menu.addMenuItem(item);

            const reviewerStatuses = pr.reviewers.map(reviewer =>
                `${reviewer.displayName ?? 'Reviewer'}: ${this._reviewerVoteLabel(reviewer.vote)}`
            );
            this._indicator.menu.addMenuItem(new PopupMenu.PopupMenuItem(
                `Reviewers: ${reviewerStatuses.join(', ') || 'None'}`,
                {reactive: false}
            ));
        }
    }

    _reviewerVoteLabel(vote) {
        switch (vote) {
        case 10:
            return 'Approved';
        case 5:
            return 'Approved with suggestions';
        case 0:
            return 'No vote';
        case -5:
            return 'Waiting for author';
        case -10:
            return 'Rejected';
        default:
            return 'Unknown';
        }
    }
}
