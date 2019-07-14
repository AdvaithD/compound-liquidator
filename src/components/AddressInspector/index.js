import React from 'react';

// import ReactTable from "react-table";
import BalanceTable from "../../components/BalanceTable/index.js"
import { BigNumber } from "bignumber.js";

import { useWeb3Context } from "web3-react/hooks";

import "./AddressInspector.css"

var app;
var accountLiquidity = 0;
var web3;

var maxRepayAmount = 0;
var tokenAddressToBeRepaid = "";

function GetIntendedRepayAmount() {
  var repaySlider = document.getElementById('repaySlider');

  return new BigNumber(repaySlider.value / repaySlider.max * maxRepayAmount).toFixed(4);
}

function OnRepaySliderValueChange() {
  // update the liquidation button text
  var repayAmount = GetIntendedRepayAmount();

  var liquidationButton = document.getElementById('LiquidateButton');

  liquidationButton.innerText = "Repay " + repayAmount + " " + app.state.asset_repay;

  // update the estimated collection amount text
  var assetCollateralAddress = null;

  // first determine which asset the user will be collecting
  app.state.TOKENS.forEach(t => {
    console.log(t);
    if (t.symbol === app.state.asset_collect) {
      assetCollateralAddress = t.address;
    }
  });

  var liduidationDetailsText = document.getElementById('LiquidationDetailsText');

  if ((assetCollateralAddress !== null) && (repayAmount > 0)) {
    // first take the repay amount and convert to eth
    var assetRepayExchangeRate = app.state.asset_prices[tokenAddressToBeRepaid];
    // factor in the liquidation discount amount
    var estimatedCollectionAmountInEth = (repayAmount * assetRepayExchangeRate) * (1 + app.state.liquidationDiscount);
    // then get the exchange rate for the collection asset
    var assetCollectExchangeRate = app.state.asset_prices[assetCollateralAddress];
    console.log(assetCollectExchangeRate);
    // and determine how much the user will receive in the collection asset
    var estimatedCollectionAmountInAsset = (estimatedCollectionAmountInEth / assetCollectExchangeRate).toFixed(6);

    // the exchange rate between the asset that we're repaying / collecting
    var repayForCollectExchangeRate = (repayAmount / estimatedCollectionAmountInAsset).toFixed(4);

    liduidationDetailsText.innerText = "You will collect an (estimated) ~" + estimatedCollectionAmountInAsset + " " +
      app.state.asset_collect + ". (Rate = " + repayForCollectExchangeRate + " " + app.state.asset_repay + "/" +
      app.state.asset_collect + ")";
  } else {
    liduidationDetailsText.innerText = ".";
  }
}

function OnRefreshClicked() {
  accountLiquidity = 0;
  tokenAddressToBeRepaid = "";

  document.getElementById('repaySlider').value = 50;

  document.getElementById('LiquidateButton').innerText = "Repay";

  document.getElementById('LiquidationDetailsText').innerText = ".";

  app.setState({
    borrow_balances : {},
    supply_balances : {},

    pending_balances: {}, // what we're currently fetching

    asset_repay: "",
    asset_collect: "",

    repaySubmittedTxHash : "",

    liquidateBlocked : true
  });
}

function OnBackClicked() {
  accountLiquidity = 0;
  tokenAddressToBeRepaid = "";

  app.setState({
    inspected_address: "",

    borrow_balances: {},
    supply_balances: {},

    pending_balances: {}, // what we're currently fetching

    asset_repay: "",
    asset_collect: "",

    repaySubmittedTxHash : "",

    liquidateBlocked : true
  });
}

function OnCopyAddressClicked() {
  // build the URL we want to copy
  var url = "https://conlan.github.io/compound-liquidator?address=" + app.state.inspected_address;

  // hack to copy text to clipboard
  const el = document.createElement('textarea');
  el.value = url;
  el.setAttribute('readonly', '');
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);

  // tell the user what happened
  window.alert("\"" + url + "\" copied to clipboard.");
}

function InitiateLiquidate() {
  var requestAmountClose = GetIntendedRepayAmount();

  if (Number(requestAmountClose) === 0) {
    window.alert("Please set an amount greater than 0.");
  } else {
    var myAccount = web3.account;
    var targetAccount = app.state.inspected_address;

    console.log(targetAccount);

    // determine the asset borrow and collateral
    var assetBorrow = "";
    var assetBorrowDecimals = 0;

    var assetCollateral = "";

    app.state.TOKENS.forEach(t => {
      if (t.symbol === app.state.asset_collect) {
        assetCollateral = t.address; // the asset we're collecting is the one that the target collateralized
      }

      if (t.symbol === app.state.asset_repay) {
        assetBorrow = t.address; // the asset that the target borrowed is the one that we are repaying on behalf of them

        assetBorrowDecimals = Math.pow(10, t.decimals);
      }
    });

    // TODO enforce user's balance available
    requestAmountClose = new BigNumber(requestAmountClose * assetBorrowDecimals).toFixed();

    console.log(requestAmountClose);

    var compoundContract = new web3.web3js.eth.Contract(app.state.LIQUIDATION_ABI, app.state.LIQUIDATION_ADDRESS);

    compoundContract.methods.liquidateBorrow(targetAccount, assetBorrow, assetCollateral, requestAmountClose).send(
      { from: myAccount }
    ).on('transactionHash', (txHash) => {
      // clear out the estimated collection liquidation details
      document.getElementById('LiquidationDetailsText').innerText = ".";

      app.setState({
        asset_repay: "",
        asset_collect: "",

        repaySubmittedTxHash : txHash
      });// TODO await confirmation
    }).on("confirmation", (err, receipt) => {
      if (app.state.repaySubmittedTxHash === receipt.transactionHash) {
        OnRefreshClicked();
      }
  });
  }
}

function GetInspectedAccount() {
	var inspected_account = null;

    app.state.accounts.forEach(account => {
    	if (account.address.toLowerCase() == app.state.inspected_address.toLowerCase()) {
    		inspected_account = account;
    	}
   	});

   	return inspected_account;
}

function AddressInspector (props) {
    app = props.app;

    web3 = useWeb3Context();

    if (accountLiquidity === 0) {
      var compoundContract = new web3.web3js.eth.Contract(app.state.COMPTROLLER_ABI, app.state.COMPTROLLER_ADDRESS);

      // only if we're not fetching a pending balance
      if (Object.keys(app.state.pending_balances).length === 0) {
        compoundContract.methods.getAccountLiquidity(app.state.inspected_address).call(function(error, result) {
          if (error == null) {
              if (Number(result[1]) <= 0) {
                accountLiquidity = new BigNumber(result[2] / 1e18);
                console.log(accountLiquidity);
                var liquidateBlocked = (accountLiquidity >= 0);

                app.setState({
                  liquidateBlocked : liquidateBlocked
                });

                // reset the repay slider to min
                var repaySlider = document.getElementById('repaySlider');
                repaySlider.value = repaySlider.min;
              }
            } else {
              console.log(error);
            }
        });
      }
    }

    // refresh not disabled by default
    var refreshDisabled = false;

    // but check that we have all the borrow balances fetched
    if ((Object.keys(app.state.borrow_balances).length) < Object.keys(app.state.TOKENS).length) {
      refreshDisabled = true;
    } else if ((Object.keys(app.state.supply_balances).length) < Object.keys(app.state.TOKENS).length) {
      // and all the supply balances fetched. If either of these aren't fully fetched then disable refresh
      refreshDisabled = true;
    }

    var canLiquidate = false;

    var liquidationText = ".";

    var transactionSubmittedText = "";
    var transationSubmittedLink = "";
    var transactionSpinnerVisibility = 'hidden';

    var repaySliderDisabled = true;

    // only enable liquidate button if both asset to repay and collect have been set
    if ((app.state.asset_repay.length > 0) && (app.state.asset_collect.length > 0)) {
      if (app.state.asset_repay !== app.state.asset_collect) {
        canLiquidate = true;

        repaySliderDisabled = false;

        // find the address for the token that the user has selected to repay
        app.state.TOKENS.forEach(t => {
          if (t.symbol === app.state.asset_repay) {
            tokenAddressToBeRepaid = t.address;
          }
        });

        // calculate the maximum amount that the user can liquidate
        var inspected_account = GetInspectedAccount();
        // we can actually liquidate more than just their account liquidity since after seizing assets from their supply, the account's ratio will go under 1.5x and so forth.
        // this determines the maximum amount that we can seize in 1 liquidation
        var maxRepayAmountInEth = ((app.state.MIN_COLLATERAL_RATIO * inspected_account.totalEthBorrow) - inspected_account.totalEthSupply) / (app.state.MIN_COLLATERAL_RATIO - app.state.liquidationDiscount - 1);
        maxRepayAmountInEth /= 1e18; // convert from wei

        if (tokenAddressToBeRepaid in app.state.asset_prices) {
          var assetRepayExchangeRate = app.state.asset_prices[tokenAddressToBeRepaid];

          maxRepayAmount = (maxRepayAmountInEth / assetRepayExchangeRate);

          // factor in the borrower's balance as the max repay amount too (can't pay more than they borrowed!)
          maxRepayAmount = Math.min(maxRepayAmount, app.state.borrow_balances[tokenAddressToBeRepaid]);
        } else {
          maxRepayAmount = 0;
        }
      } else {
        liquidationText = "Unable to repay " + app.state.asset_repay + " and collect same asset " + app.state.asset_collect + ".";
      }
    }

    if (app.state.repaySubmittedTxHash.length > 0) {
      transactionSubmittedText = "Repay submitted! View your tx: "
      transationSubmittedLink = app.state.ETHERSCAN_PREFIX + "tx/" + app.state.repaySubmittedTxHash;

      // show the spinner
      transactionSpinnerVisibility = 'visible';
    }

    var liquidationDiscountDisplay = "";
    if (app.state.liquidationDiscount < 0) {
      liquidationDiscountDisplay = "-";
    } else {
      liquidationDiscountDisplay = (app.state.liquidationDiscount * 100);
    }

    var accountLiquidityDisplay = "";
    if (accountLiquidity !== 0) {
      accountLiquidityDisplay = accountLiquidity + " ETH";
    } else {
      // if account liquidity not set then disable refresh
      refreshDisabled = true;
    }

    var stateColor = (app.state.inspected_address_state === 'risky') ? '#ffbf00' :
      (app.state.inspected_address_state === 'safe') ? '#57d500' : '#ff2e00';

    var stateText = app.state.inspected_address_state;

    return (
      <div className="AddressInspector">
        <div>
          <p className="SameLine"><b>Address:</b> <i>{app.state.inspected_address} </i></p>
          <button onClick={() => OnCopyAddressClicked()}><img className="CopyButton" alt="copy" src="./copy.png"/></button>

          <button className="RefreshButton" onClick={() => OnRefreshClicked()} disabled={refreshDisabled}>Refresh</button>
        </div>
        <p><b>Account Liquidity:</b> {accountLiquidityDisplay}</p>
        <span><p><b>State: </b><span style={{color:stateColor}}>&#x25cf;</span> {stateText}</p></span>

        <p>Choose an asset to collect at {liquidationDiscountDisplay}% discount:</p>
        <BalanceTable app={app} balanceType="Supplied" stateProperty="asset_collect"/>

        <p>Choose a different asset to repay on behalf of borrower to return their <b>Account Liquidity</b> to 0:</p>

        <BalanceTable app={app} balanceType="Borrowed" stateProperty="asset_repay"/>
        <br/>

        <div className="ButtonDiv">
          <button className="BackButton" onClick={() => OnBackClicked()}>Back</button>

          <button className="LiquidateButton" disabled={!canLiquidate} id="LiquidateButton"
            onClick={() => InitiateLiquidate()}
          >Repay</button>

          <input type="range" onInput={() => OnRepaySliderValueChange()} min={0} max={100}
            className="slider" id="repaySlider" disabled={repaySliderDisabled}/>

        </div>

        <p className="LiquidationDetails" id="LiquidationDetailsText">{liquidationText}</p>

        <div className="TransactionPendingDiv">
          <p className="TransactionSubmissionDetails">{transactionSubmittedText}<a href={transationSubmittedLink}
              rel="noopener noreferrer" target="_blank">{transationSubmittedLink}</a> <img style={{visibility:transactionSpinnerVisibility}} alt="loading" src="./small-loading.gif"/></p>
        </div>
      </div>

    )
  }

  export default AddressInspector;
