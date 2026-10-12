import { render } from 'preact';
import { AppController } from './state/controller';
import { App } from './ui/App';
import { registerWebMcp } from './state/webmcp';
import './styles.css';

const controller = new AppController();
render(<App controller={controller} />, document.getElementById('app')!);
registerWebMcp(controller);
