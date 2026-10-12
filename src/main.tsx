import { render } from 'preact';
import { AppController } from './state/controller';
import { App } from './ui/App';
import './styles.css';

const controller = new AppController();
render(<App controller={controller} />, document.getElementById('app')!);
