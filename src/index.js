/*global ENV */
import React from "react";
import ReactDOM from "react-dom";
import { App } from './app';

ReactDOM.render(
    <App className="app" metamaskInstalled={web3 !== 'undefined'} />,
    document.getElementById("root")
);




