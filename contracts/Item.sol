pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Counters.sol";

contract Item is ERC721, AccessControl {
    using Counters for Counters.Counter;
    Counters.Counter private _tokenIds;

    event MintEvent(address player, string metadataURI);

    constructor() public ERC721("Item", "ITM") {}

    function mintToken(address player, string memory metadataURI)
        public
        returns (uint256)
    {
        emit MintEvent(player, metadataURI);

        _tokenIds.increment();

        uint256 newItemId = _tokenIds.current();
        _mint(player, newItemId);
        _setTokenURI(newItemId, metadataURI);

        return newItemId;
    }
}
